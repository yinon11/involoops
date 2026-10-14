"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import {
  writeSwitchBackCookie,
  clearSwitchBackCookie,
} from "@/lib/team/switch-back-cookie";
import { getDictionary } from "@/lib/i18n/server";

const switchSchema = z.object({
  targetUserId: z.string().uuid("Invalid target user id"),
  viaSwitchBack: z.boolean().optional(),
});

/**
 * Switch the current session into a linked account (or back to the originator).
 *
 * Security: the actual permission check lives in the "switch-account" Credentials
 * provider's `authorize()` in `src/auth.ts` — it re-reads the link row from the DB
 * on every call, so this action never has to trust the client-supplied id.
 *
 * Calling `signIn` replaces the NextAuth session cookie with a fresh JWT for the
 * target user; from the browser's point of view it is identical to logging out
 * and logging in as the new account.
 *
 * When `viaSwitchBack` is true (user clicked "Switch back to {owner}" in the
 * avatar menu) we set the `iv_switch_back` cookie so the post-login route does
 * NOT immediately bounce the user back into the owner's account on the next
 * sign-in / page reload. Forward switches clear the cookie.
 */
export async function switchAccountAction(
  targetUserId: string,
  viaSwitchBack = false,
) {
  const dict = await getDictionary();
  const validated = switchSchema.safeParse({ targetUserId, viaSwitchBack });
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  if (validated.data.viaSwitchBack) {
    await writeSwitchBackCookie();
  } else {
    await clearSwitchBackCookie();
  }

  try {
    await signIn("switch-account", {
      targetUserId: validated.data.targetUserId,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: dict.errors.accountSwitchNotPermitted };
    }
    throw error;
  }
}
