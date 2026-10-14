import { NextResponse } from "next/server";
import { AuthError } from "next-auth";
import { eq } from "drizzle-orm";
import { auth, signIn } from "@/auth";
import { db } from "@/db";
import { accountLinks, users } from "@/db/schema";
import { getPublicAppOrigin } from "@/lib/public-app-origin";
import { hasSwitchBackCookie } from "@/lib/team/switch-back-cookie";
import { isStudioPinnedEmail } from "@/lib/auth/studio-pinned-accounts";

export const runtime = "nodejs";

/**
 * Decides where a signed-in user lands when they enter the app.
 *
 * Three cases, in priority order:
 *
 * 1. **Acting-as session hits an auth entry route** (e.g. they tried to
 *    open /login or /register while still impersonating). The `signIn`
 *    call here can write the new session cookie because we are in a Route
 *    Handler. We switch them back to the originator.
 *
 * 2. **Sub-user just signed in and has exactly one linked owner**. If
 *    that link's `auto_act_as` flag is true AND the user did NOT
 *    recently click "Switch back" (which sets `iv_switch_back`), we
 *    automatically switch them into the owner's account. This means a
 *    pure sub-user never has to use the avatar menu.
 *
 * 3. **Anything else** — pass through to `/` (InvoLoops home).
 *
 * Login/register pages cannot call `signIn` (cookie writes) during Server
 * Component render. Those flows redirect here so the switch runs in a
 * place where `cookies().set` is allowed.
 */
/**
 * Honour ?next=... as the final destination for the redirects below. Only
 * relative paths starting with `/` are accepted (open-redirect guard).
 */
function safeNext(request: Request): string {
  const raw = new URL(request.url).searchParams.get("next");
  if (typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/";
}

export async function GET(request: Request) {
  const origin = getPublicAppOrigin(request);
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  let next = safeNext(request);

  // Studio-pinned accounts always land in the creator shell. Resolve the
  // signed-in user's own email (the credentials/OAuth account before any
  // act-as switch) and override the destination. `/creator` flips the mode
  // cookie to "creator" via middleware, so the Studio shell renders.
  const signedInUserId = session.user.id;
  if (signedInUserId) {
    const me = await db.query.users.findFirst({
      where: eq(users.id, signedInUserId),
      columns: { email: true },
    });
    if (
      isStudioPinnedEmail(me?.email) &&
      !next.startsWith("/oauth/interaction/")
    ) {
      next = "/money-in";
    }
  }

  // Case 1 — already acting-as, send back to the originator.
  const originatorId = session.user.originator?.id;
  if (originatorId) {
    try {
      await signIn("switch-account", {
        targetUserId: originatorId,
        redirectTo: next,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.redirect(new URL(next, origin));
      }
      throw error;
    }
    return NextResponse.redirect(new URL(next, origin));
  }

  // Case 2 — auto-act-as on sign-in for a single linked owner.
  //
  // Read links straight from the DB instead of trusting session.linkedAccounts
  // because the latter is the JWT's cached copy: a link revoked since the
  // session was issued would still appear there. Cost is one indexed lookup
  // per entry navigation.
  const userId = session.user.id;
  if (userId) {
    const blocked = await hasSwitchBackCookie();
    if (!blocked) {
      const [links, me] = await Promise.all([
        db
          .select({
            managedUserId: accountLinks.managedUserId,
            autoActAs: accountLinks.autoActAs,
          })
          .from(accountLinks)
          .where(eq(accountLinks.managerUserId, userId))
          .limit(2),
        db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { autoActAsManagedAccounts: true },
        }),
      ]);
      const managerOptedIn = me?.autoActAsManagedAccounts !== false;

      if (links.length === 1 && links[0].autoActAs && managerOptedIn) {
        try {
          await signIn("switch-account", {
            targetUserId: links[0].managedUserId,
            redirectTo: next,
          });
        } catch (error) {
          if (error instanceof AuthError) {
            return NextResponse.redirect(new URL(next, origin));
          }
          throw error;
        }
      }
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
