"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { signIn, signOut } from "@/auth";
import { AuthError } from "next-auth";
import { assignFreePlan } from "@/lib/assign-free-plan";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sendNewUserSignupNotification } from "@/lib/email/transactional";
import { issueEmailVerificationToken } from "@/actions/email-verification-actions";
import { getDictionary, getLocale } from "@/lib/i18n/server";

/**
 * Resolve the best-effort client IP from the forwarded request headers. Used
 * as a rate-limit bucket for auth endpoints so a single IP can't brute-force
 * passwords. Falls back to "unknown" when the headers are missing.
 */
async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

const signupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
      "Password must include an uppercase letter, a lowercase letter, and a number"
    ),
  consent: z.literal("true", {
    message: "You must accept the Terms of Service and Privacy Policy",
  }),
  marketingOptIn: z.enum(["true", "false"]).optional(),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  mfaCode: z.string().optional(),
  /**
   * Optional post-sign-in destination, e.g. `/invite/<token>`. Only relative
   * paths are honoured to prevent open-redirect attacks.
   */
  callbackUrl: z
    .string()
    .startsWith("/", "callbackUrl must be a relative path")
    .optional(),
  /**
   * Set by the accountant login page. Routes them straight to the income
   * overview after sign-in (see `/api/auth/resolve-accountant-entry`).
   */
  accountant: z.enum(["true", "false"]).optional(),
});

/**
 * Public signup: creates a new user with password credentials and assigns the free plan.
 */
export async function signupAction(formData: FormData) {
  const dict = await getDictionary();
  const rawData = {
    name: formData.get("name") as string,
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    consent: formData.get("consent") as string,
    marketingOptIn: (formData.get("marketingOptIn") as string) ?? "false",
  };

  const validated = signupSchema.safeParse(rawData);
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  const { name, email, password, marketingOptIn } = validated.data;
  const marketingEnabled = marketingOptIn === "true";

  // 10 signups per hour per IP — more than enough for legit usage, blocks
  // automated account-farming from a single source.
  const ip = await getClientIp();
  const limit = await enforceRateLimit(`signup:${ip}`, 10, 60 * 60);
  if (!limit.ok) {
    return { error: dict.errors.tooManySignupAttempts };
  }

  try {
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingUser) {
      return { error: dict.errors.invalidEmailOrPassword };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    // Capture the visitor's resolved locale (CF-IPCountry → Accept-Language → cookie)
    // so the welcome funnel (sent later by cron) renders in the right language.
    // The user can still override later via the header picker.
    const preferredLocale = await getLocale();
    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email,
        passwordHash,
        preferredLocale,
        marketingOptIn: marketingEnabled,
        marketingOptInAt: marketingEnabled ? new Date() : null,
      })
      .returning();

    if (newUser) {
      try {
        await assignFreePlan(newUser.id);
      } catch (err) {
        console.error("[Signup] Post-creation setup error:", err);
      }

      try {
        const result = await sendNewUserSignupNotification({
          name: newUser.name,
          email: newUser.email,
          provider: "credentials",
        });
        if (!result.ok) {
          console.error("[Signup] Notify email failed:", result.error);
        }
      } catch (err) {
        console.error("[Signup] Notify email threw:", err);
      }

      try {
        const result = await issueEmailVerificationToken(newUser.id);
        if (!result.ok) {
          console.error("[Signup] Verification email failed:", result.error);
        }
      } catch (err) {
        console.error("[Signup] Verification email threw:", err);
      }
    }

    return { success: true as const };
  } catch {
    return { error: dict.errors.somethingWentWrong };
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function loginAction(formData: FormData) {
  const dict = await getDictionary();
  const rawCallback = formData.get("callbackUrl");
  const rawData = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    mfaCode: (formData.get("mfaCode") as string | null) ?? undefined,
    callbackUrl:
      typeof rawCallback === "string" && rawCallback.length > 0
        ? rawCallback
        : undefined,
    accountant: formData.get("accountant") === "true" ? "true" : undefined,
  };

  const validated = loginSchema.safeParse(rawData);
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  // Two buckets so both credential-stuffing (many emails, one IP) and
  // per-account guessing (one email, many IPs) get slowed down.
  const ip = await getClientIp();
  const email = validated.data.email.toLowerCase().trim();
  const ipLimit = await enforceRateLimit(`login:ip:${ip}`, 20, 5 * 60);
  if (!ipLimit.ok) {
    return { error: dict.errors.tooManyLoginAttempts };
  }
  const emailLimit = await enforceRateLimit(`login:email:${email}`, 10, 15 * 60);
  if (!emailLimit.ok) {
    return { error: dict.errors.tooManyLoginAttemptsAccount };
  }

  // Pre-check MFA status so we can prompt the user for the second factor in
  // a dedicated UI step. The authoritative check still happens inside
  // authorize() — this is purely a UX router.
  const mfaCode = validated.data.mfaCode?.trim() ?? "";
  if (!mfaCode) {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { passwordHash: true, mfaEnabled: true },
    });
    if (existing?.passwordHash && existing.mfaEnabled) {
      const passwordOk = await bcrypt.compare(
        validated.data.password,
        existing.passwordHash
      );
      if (passwordOk) {
        return { mfaRequired: true as const };
      }
    }
  }

  try {
    // Route through the entry-session resolver so a sub-user with a single
    // linked owner lands directly inside that owner's account. The resolver
    // falls through to /dashboard for everyone else, and honours an
    // explicit ?callbackUrl=... by appending it as `next`.
    //
    // The accountant entry point uses a thin wrapper resolver that lands
    // the user on the income overview before delegating to the same
    // entry-session logic.
    const next = validated.data.callbackUrl;
    const base =
      validated.data.accountant === "true"
        ? "/api/auth/resolve-accountant-entry"
        : "/api/auth/resolve-entry-session";
    const redirectTo = next
      ? `${base}?next=${encodeURIComponent(next)}`
      : base;
    // `redirect: false` so the session cookie is committed as part of THIS
    // action's response. The client then performs a full-page navigation to
    // `redirectTo` (see login-form), which reliably carries the just-set
    // cookie to the resolver route handler. A soft (router) navigation here
    // races with the cookie write — the resolver's `auth()` intermittently
    // sees no session and bounces to /login, which only clears on refresh.
    await signIn("credentials", {
      email: rawData.email,
      password: rawData.password,
      mfaCode,
      redirect: false,
    });
    return { ok: true as const, redirectTo };
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return mfaCode
            ? { error: dict.errors.invalidVerificationCodeShort, mfaRequired: true as const }
            : { error: dict.errors.invalidEmailOrPassword };
        default:
          return { error: dict.errors.somethingWentWrong };
      }
    }
    throw error;
  }
}
