import "server-only";
import { cookies } from "next/headers";

/**
 * Marker cookie that suppresses the post-login "auto-act-as" behavior.
 *
 * The post-login route normally switches a sub-user into their owner's
 * account when they have exactly one linked owner. After the user
 * explicitly clicks "Switch back" we set this cookie so the next login
 * (or reload of the entry route) keeps them on their own account, instead
 * of immediately bouncing them back into the owner.
 *
 * TTL is intentionally long enough to span a working session (6h) but
 * short enough that a sub-user who forgot they switched back gets the
 * auto-switch experience again the next day. Cleared explicitly when the
 * user re-enters the owner's account via the avatar menu.
 */
export const SWITCH_BACK_COOKIE = "iv_switch_back";
export const SWITCH_BACK_TTL_SECONDS = 60 * 60 * 6;

export async function writeSwitchBackCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SWITCH_BACK_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_URL?.startsWith("https://") ?? false,
    path: "/",
    maxAge: SWITCH_BACK_TTL_SECONDS,
  });
}

export async function clearSwitchBackCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SWITCH_BACK_COOKIE);
}

export async function hasSwitchBackCookie(): Promise<boolean> {
  const jar = await cookies();
  return Boolean(jar.get(SWITCH_BACK_COOKIE)?.value);
}
