"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import {
  APP_MODES,
  MODE_LANDING,
  isAppMode,
  writeMode,
  type AppMode,
} from "@/lib/mode";
import { getDictionary } from "@/lib/i18n/server";

export type SwitchModeResult =
  | { ok: true; href: string }
  | { ok: false; error: string };

/**
 * Switch the caller's active product shell.
 *
 *   - `admin`   : platform admin only.
 *   - `creator` : InvoLoops Studio — available to every signed-in user.
 *   - `expense` : InvoLoops (expense / new-design home).
 *
 * Callers must `window.location.assign(href)` so the next document load
 * sees the new mode cookie (redirect() from a Radix menu + transition is
 * often dropped).
 */
export async function switchMode(next: AppMode): Promise<SwitchModeResult> {
  const dict = await getDictionary();
  if (!isAppMode(next) || !APP_MODES.includes(next)) {
    return { ok: false, error: `Unknown mode: ${next}` };
  }

  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: dict.errors.notSignedIn };
  }

  if (next === "admin") {
    const admin = await isUserAdmin(session.user.id);
    if (!admin) {
      await writeMode("expense");
      revalidatePath("/", "layout");
      return { ok: true, href: MODE_LANDING.expense };
    }
  }

  await writeMode(next);
  revalidatePath("/", "layout");
  return { ok: true, href: MODE_LANDING[next] };
}
