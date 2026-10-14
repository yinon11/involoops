import NextAuth from "next-auth";
import type { User } from "next-auth";
import { decode } from "next-auth/jwt";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/db";
import { accountLinks, accounts, users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { authDebug, authLogError } from "@/lib/auth-debug";
import { assignFreePlan } from "@/lib/assign-free-plan";
import { sendNewUserSignupNotification } from "@/lib/email/transactional";
import { authConfig, SESSION_COOKIE_NAME, SECURE_COOKIES } from "@/auth.config";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_EXPLICIT_COOKIE,
  LOCALE_AUTO_SET_COOKIE,
} from "@/lib/i18n";
import { localeFromRequest } from "@/lib/i18n/server";

/** Marker field used to pass the pre-switch user id from authorize() to jwt(). */
const SWITCH_ORIGINATOR_HINT = "__switchOriginatorId" as const;
/**
 * Marker field used to pass the link's capability list from authorize() to
 * jwt() during a switch-account flow. `undefined` = no hint (normal sign-in
 * or switch-back). `null` = admin impersonation (full access). Array = the
 * granted capability codes from the account_links row.
 */
const SWITCH_CAPABILITIES_HINT = "__switchCapabilities" as const;

/**
 * Whether `memberId` is "locked" into acting-as `ownerId` because the owner
 * enabled "Sign in directly to my account" (`account_links.auto_act_as`) for a
 * dedicated sub-user. Mirrors the auto-act-as eligibility used by the entry
 * resolver: exactly one link, that link points at `ownerId`, `auto_act_as` is
 * on, and the member has not opted out (and is not a platform admin). When this
 * is true the member must NOT be allowed to switch back to their own account.
 */
async function isAutoActAsLocked(
  memberId: string,
  ownerId: string,
): Promise<boolean> {
  try {
    const links = await db
      .select({
        managedUserId: accountLinks.managedUserId,
        autoActAs: accountLinks.autoActAs,
      })
      .from(accountLinks)
      .where(eq(accountLinks.managerUserId, memberId))
      .limit(2);
    if (links.length !== 1) return false;
    const only = links[0];
    if (only.managedUserId !== ownerId || !only.autoActAs) return false;
    const member = await db.query.users.findFirst({
      where: eq(users.id, memberId),
      columns: { isAdmin: true, autoActAsManagedAccounts: true },
    });
    if (member?.isAdmin) return false;
    if (member?.autoActAsManagedAccounts === false) return false;
    return true;
  } catch (err) {
    authLogError("isAutoActAsLocked: query failed", err);
    return false;
  }
}

/**
 * Raw Google ID-token claim. Auth.js passes this profile into the sign-in
 * event, then forces `emailVerified: null` on the new user row, so the claim
 * has to be applied afterwards. Password signups never carry it.
 */
function googleEmailIsVerified(profile: unknown): boolean {
  if (!profile || typeof profile !== "object") return false;
  return (profile as { email_verified?: unknown }).email_verified === true;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // Map to real table names (`users`, `accounts`, …). Default adapter uses `user` / `account`
  // and breaks OAuth sign-in with "Configuration" if those tables do not exist.
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    // JWT sessions — DB `sessions` table shape differs from Auth.js default; omit so OAuth uses users/accounts only.
  }),
  // Auth.js defaults to `useSecureCookies` from the *incoming* request URL. Behind TLS termination
  // the app often sees `http:`, so PKCE cookies get wrong `Secure`/`__Secure-` settings and Google
  // callback fails with InvalidCheck: pkceCodeVerifier value could not be parsed.
  useSecureCookies: SECURE_COOKIES,
  events: {
    async signOut() {
      authDebug("signOut event");
    },
    async signIn({ user, account, profile }) {
      if (!user?.id) return;
      // Google has already confirmed the address. Persist that so these
      // accounts skip the password-signup verification email. Only fills a
      // null timestamp — it never clears a verification.
      if (account?.provider === "google" && googleEmailIsVerified(profile)) {
        try {
          await db
            .update(users)
            .set({ emailVerified: new Date() })
            .where(and(eq(users.id, user.id), isNull(users.emailVerified)));
        } catch (err) {
          authLogError("signIn: google emailVerified backfill failed", err);
        }
      }
      // First-login locale backfill. Runs once per sign-in; only writes the
      // DB when the user has no stored preference. Priority:
      //   (a) explicit anon pick → promote the cookie value to DB,
      //   (b) otherwise infer from CF-IPCountry / Accept-Language.
      // Also sets the `NEXT_LOCALE_AUTO` hint cookie so the client can surface
      // a one-time toast explaining the choice. When (a) applies we skip the
      // toast: the user already knows what they picked.
      try {
        const row = await db.query.users.findFirst({
          where: eq(users.id, user.id),
          columns: { preferredLocale: true },
        });
        if (row?.preferredLocale) return;

        const cookieStore = await cookies();
        const explicit =
          cookieStore.get(LOCALE_EXPLICIT_COOKIE)?.value === "1";
        const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
        const chosen =
          explicit && isLocale(cookieLocale)
            ? cookieLocale
            : await localeFromRequest();

        await db
          .update(users)
          .set({ preferredLocale: chosen })
          .where(eq(users.id, user.id));

        if (!explicit) {
          // Non-httpOnly so the client can read & clear it after showing a toast.
          cookieStore.set(LOCALE_AUTO_SET_COOKIE, chosen, {
            path: "/",
            maxAge: 60 * 5,
            sameSite: "lax",
            secure: SECURE_COOKIES,
          });
          // Mirror into the cookie so the very next render picks it up without
          // waiting for the JWT callback to refresh from DB.
          cookieStore.set(LOCALE_COOKIE, chosen, {
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            sameSite: "lax",
            secure: SECURE_COOKIES,
          });
        }
      } catch (err) {
        authLogError("signIn: preferred_locale backfill failed", err);
      }
    },
    async createUser({ user }) {
      // Assign free plan to new users created via OAuth (e.g. Google sign-in)
      if (user.id) {
        try {
          await assignFreePlan(user.id);
        } catch (err) {
          console.error("[Auth] Failed to assign free plan to new OAuth user:", err);
        }

        try {
          const result = await sendNewUserSignupNotification({
            name: user.name ?? null,
            email: user.email ?? null,
            provider: "google",
          });
          if (!result.ok) {
            console.error("[Auth] Signup notify email failed:", result.error);
          }
        } catch (err) {
          console.error("[Auth] Signup notify email threw:", err);
        }
      }
    },
  },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            // Do not link Google to an existing email/password account — those users must sign in with password.
            // OAuth-only users can add a password in Settings instead.
            //
            // MFA is INTENTIONALLY NOT ENFORCED on Google sign-ins. The TOTP
            // gate below (in the Credentials provider) covers email+password
            // only. Rationale: a user signing in with Google has already
            // authenticated against Google's own account — including any 2FA
            // they enabled there — and Google's session is the second factor
            // from this app's perspective. Layering an in-app TOTP on top
            // would prompt every login, which most users would experience
            // as a UX regression rather than a security win.
            //
            // Trade-off: a user who enables MFA in Settings but then signs
            // in with Google will NOT be challenged by THIS app for a code
            // (they're expected to have 2FA configured at Google). If you
            // want the in-app TOTP to fire on every sign-in regardless of
            // provider, replace this comment with the post-OAuth challenge
            // flow described in `docs/` (set `mfaVerifiedAt` claim on the
            // JWT in the credentials path, gate app routes on its presence,
            // add an `/mfa-challenge` page).
            //
            // Show Google’s account picker instead of silently using the last active Google session.
            authorization: {
              params: {
                prompt: "select_account",
              },
            },
          }),
        ]
      : []),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mfaCode: { label: "MFA Code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;
        const mfaCode =
          typeof credentials.mfaCode === "string" ? credentials.mfaCode : "";

        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);

        if (!isValid) {
          return null;
        }

        // MFA gate. When the user has a confirmed second factor we require a
        // valid TOTP (or backup code) as part of the same `authorize()` call
        // so nobody can bypass the check by going around `loginAction`. The
        // loginAction flow always pre-checks MFA status and surfaces the
        // second-step UI, so a missing code here means someone is hitting
        // Auth.js directly — reject.
        if (user.mfaEnabled) {
          if (!mfaCode.trim()) {
            return null;
          }
          const { verifyMfaInput } = await import("@/actions/mfa-actions");
          const result = await verifyMfaInput({
            input: mfaCode,
            ciphertext: user.mfaSecretCiphertext,
            iv: user.mfaSecretIv,
            tag: user.mfaSecretTag,
            backupHashes: user.mfaBackupCodes ?? [],
          });
          if (!result.valid) {
            return null;
          }
          if (result.updatedBackupHashes) {
            // Consume the single-use backup code atomically with sign-in.
            await db
              .update(users)
              .set({ mfaBackupCodes: result.updatedBackupHashes })
              .where(eq(users.id, user.id));
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    // Internal provider that mints a fresh JWT for a target account. Invoked by
    // `switchAccountAction` after the user clicks a linked account in the avatar
    // menu. Security: authorize() re-verifies the link in the DB on every call.
    Credentials({
      id: "switch-account",
      name: "switch-account",
      credentials: {
        targetUserId: { label: "Target User ID", type: "text" },
      },
      async authorize(credentials) {
        const targetUserId = credentials?.targetUserId;
        if (typeof targetUserId !== "string" || !targetUserId) {
          return null;
        }

        // Read the current session straight from the cookie. We cannot call
        // `auth()` here — it would recurse into the Credentials dispatcher.
        let currentUserId: string | null = null;
        let currentOriginatorId: string | null = null;
        try {
          const cookieStore = await cookies();
          const tokenValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;
          if (!tokenValue) return null;
          const decoded = await decode({
            token: tokenValue,
            secret: process.env.AUTH_SECRET!,
            salt: SESSION_COOKIE_NAME,
          });
          if (!decoded || typeof decoded.sub !== "string") return null;
          currentUserId = decoded.sub;
          const maybeOriginator = (
            decoded as { originator?: { id?: string } | null }
          ).originator;
          currentOriginatorId = maybeOriginator?.id ?? null;
        } catch (err) {
          authLogError("switch-account: session decode failed", err);
          return null;
        }

        if (currentUserId === targetUserId) {
          authDebug("switch-account: already acting as target, rejecting");
          return null;
        }

        const isSwitchBack = currentOriginatorId === targetUserId;

        if (isSwitchBack) {
          // Owners can lock a dedicated sub-user into their account via
          // "Sign in directly to my account". When that lock is active the
          // member is not allowed to switch back to their own account.
          // currentUserId = owner (acting-as); targetUserId = member's own id.
          const locked = await isAutoActAsLocked(targetUserId, currentUserId);
          if (locked) {
            authDebug(
              "switch-account: switch-back blocked (auto-act-as locked)",
            );
            return null;
          }
        }

        // capabilitiesHint: undefined = no hint (will be ignored by jwt callback;
        // the inverse of the SWITCH_ORIGINATOR_HINT being set), null = full
        // access (admin impersonation, switch-back, sign-in), array = sub-user
        // restricted to that exact set.
        let capabilitiesHint: string[] | null = null;

        if (!isSwitchBack) {
          // Prevent chained switches: if already acting-as, the only allowed
          // move is "switch back" to the originator.
          if (currentOriginatorId) {
            authDebug("switch-account: chained switch rejected");
            return null;
          }
          // Re-verify the link exists in the DB — never trust the JWT's cached
          // `linkedAccounts` alone; links may have been revoked since sign-in.
          const link = await db.query.accountLinks.findFirst({
            where: and(
              eq(accountLinks.managerUserId, currentUserId),
              eq(accountLinks.managedUserId, targetUserId),
            ),
          });
          const me = await db.query.users.findFirst({
            where: eq(users.id, currentUserId),
            columns: { isAdmin: true },
          });
          const managerIsAdmin = me?.isAdmin === true;

          if (!link) {
            // Admin impersonation fallback — admins can switch into any user
            // even without an explicit account_links row. Re-read isAdmin from
            // the DB so a demoted admin loses access immediately (do NOT trust
            // the cached JWT claim).
            if (!managerIsAdmin) {
              authDebug("switch-account: no link and not admin, rejecting");
              return null;
            }
            authDebug("switch-account: admin impersonation allowed");
            // Admin: keep capabilitiesHint = null (full access).
          } else if (managerIsAdmin) {
            // Platform admins managing a linked account keep full access even
            // when the link row carries a restricted (or empty) capability set.
            authDebug("switch-account: admin via account_links, full access");
          } else {
            // Forward switch via account_links — pin the granted capabilities
            // onto the new session so server gates can read them.
            capabilitiesHint = Array.isArray(link.capabilities)
              ? (link.capabilities as string[])
              : [];
          }
        }
        // Switch-back keeps capabilitiesHint = null (back to own account → full).

        const target = await db.query.users.findFirst({
          where: eq(users.id, targetUserId),
        });
        if (!target) return null;

        // Custom fields — the jwt callback reads these to populate the token.
        return {
          id: target.id,
          email: target.email,
          name: target.name,
          image: target.image,
          [SWITCH_ORIGINATOR_HINT]: isSwitchBack ? null : currentUserId,
          [SWITCH_CAPABILITIES_HINT]: capabilitiesHint,
        } as unknown as User;
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Keep session callback Edge-safe: middleware calls /session and must not run Postgres here.
    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
        const cn = token.companyName;
        session.user.companyName =
          typeof cn === "string" ? cn : null;
        session.user.isAdmin = token.isAdmin === true;
        session.user.linkedAccounts = Array.isArray(token.linkedAccounts)
          ? token.linkedAccounts
          : [];
        session.user.originator = token.originator ?? null;
        session.user.originatorLocked = token.originatorLocked === true;
        session.user.preferredLocale =
          typeof token.preferredLocale === "string"
            ? token.preferredLocale
            : null;
        // null = full access (own account or admin impersonation); array =
        // sub-user with that exact capability set (possibly empty = deny all).
        session.user.actingAsCapabilities = Array.isArray(
          token.actingAsCapabilities,
        )
          ? token.actingAsCapabilities
          : null;
      }
      return session;
    },
    async jwt({ token, user, trigger }) {
      // Sign-in events: `user` is the object returned from authorize().
      if (user?.id) {
        token.sub = user.id;
        const hint = (user as { [SWITCH_ORIGINATOR_HINT]?: string | null })[
          SWITCH_ORIGINATOR_HINT
        ];
        if (hint !== undefined) {
          // Switch-account flow. `hint === null` means switch-back (clear originator);
          // a string value means a new fresh switch and we need to record the originator.
          if (hint === null) {
            token.originator = null;
            // Switch-back lands on the member's own account — never locked.
            token.originatorLocked = false;
          } else {
            const row = await db.query.users.findFirst({
              where: eq(users.id, hint),
              columns: { id: true, email: true, name: true },
            });
            token.originator = row
              ? { id: row.id, email: row.email, name: row.name }
              : null;
          }
          // Capability hint pairs with the originator hint:
          //   null  → full access (admin impersonation / switch-back / own login)
          //   array → sub-user restricted to those codes
          const capHint = (
            user as { [SWITCH_CAPABILITIES_HINT]?: string[] | null }
          )[SWITCH_CAPABILITIES_HINT];
          token.actingAsCapabilities = Array.isArray(capHint) ? capHint : null;
        } else {
          // Normal fresh login — clear any lingering originator/capabilities
          // from a stale token (e.g. a re-auth after the JWT expired).
          token.originator = null;
          token.actingAsCapabilities = null;
          token.originatorLocked = false;
        }
      }

      const userId = token.sub;
      if (!userId) {
        return token;
      }

      // Middleware calls Auth with the Edge runtime — Node postgres TCP cannot run there.
      // Rely on `isAdmin` / `companyName` / `linkedAccounts` / `originator` already stored
      // in the encrypted JWT from Node sign-in.
      if (process.env.NEXT_RUNTIME === "edge") {
        authDebug("jwt: edge runtime — skip db profile fetch");
        return token;
      }

      // Refreshing JWT from DB on every `auth()` causes Auth.js to rewrite the
      // session cookie, which Next.js disallows during Server Component render.
      //
      // We still want to eventually pick up role / company changes — a demoted
      // admin shouldn't keep admin privileges for the full JWT lifetime (30d
      // default). Refresh at most once every N minutes so the cookie rewrite
      // happens on a predictable cadence instead of every request.
      const isSignInEvent = Boolean(user?.id);
      const REFRESH_INTERVAL_MS = 10 * 60 * 1_000; // 10 minutes
      const lastRefresh =
        typeof token.refreshedAt === "number" ? token.refreshedAt : 0;
      const isStale = Date.now() - lastRefresh > REFRESH_INTERVAL_MS;
      if (!isSignInEvent && trigger !== "update" && !isStale) {
        return token;
      }

      const signInRefresh = isSignInEvent;
      const t0 = Date.now();
      try {
        const row = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: {
            companyName: true,
            isAdmin: true,
            preferredLocale: true,
          },
        });
        token.companyName = row?.companyName ?? null;
        token.isAdmin = row?.isAdmin === true;
        token.preferredLocale = row?.preferredLocale ?? null;

        // Only expose the manager's own linked accounts when NOT acting-as someone.
        // While A is switched into B, we hide B's linked accounts to prevent chained
        // switching — the only allowed move from a switched session is "switch back".
        if (token.originator) {
          token.linkedAccounts = [];
          // Re-evaluate the "locked to owner" state on every refresh so that an
          // owner toggling "Sign in directly to my account" off frees the
          // member on the next refresh instead of only at re-login.
          token.originatorLocked = await isAutoActAsLocked(
            token.originator.id,
            userId,
          );
        } else {
          // Own account (or switch-back): drop any stale capability pin from a
          // prior acting-as session. An empty array here denies every gate.
          token.actingAsCapabilities = null;
          token.originatorLocked = false;
          const rows = await db
            .select({
              id: users.id,
              email: users.email,
              name: users.name,
              companyName: users.companyName,
            })
            .from(accountLinks)
            .innerJoin(users, eq(accountLinks.managedUserId, users.id))
            .where(eq(accountLinks.managerUserId, userId));
          token.linkedAccounts = rows;
        }

        token.refreshedAt = Date.now();

        authDebug("jwt: profile from db", {
          sub: `${userId.slice(0, 8)}…`,
          ms: Date.now() - t0,
          signInRefresh,
          linkedCount: token.linkedAccounts?.length ?? 0,
          actingAs: Boolean(token.originator),
        });
      } catch (err) {
        token.companyName = null;
        token.isAdmin = false;
        token.linkedAccounts = [];
        token.preferredLocale = null;
        authLogError(`jwt: profile db query failed (${Date.now() - t0}ms)`, err);
      }
      return token;
    },
  },
});
