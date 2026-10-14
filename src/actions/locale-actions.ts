"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { SECURE_COOKIES } from "@/auth.config";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_EXPLICIT_COOKIE,
} from "@/lib/i18n";

/**
 * Persist the user's explicit locale choice and re-render the root layout so
 * the new dictionary / `lang` / `dir` attributes take effect everywhere.
 *
 *  - Always writes `NEXT_LOCALE` + `NEXT_LOCALE_SET=1` so the resolver knows
 *    this was an explicit pick (not geo auto-detection) and stops re-inferring.
 *  - When a session exists, also writes `users.preferred_locale` so the choice
 *    follows the user across devices and survives cookie wipes.
 *  - Cookie attributes (`secure`, `httpOnly: false`, `sameSite`) intentionally
 *    mirror the writers in `middleware.ts` and `auth.ts` so this `Set-Cookie`
 *    cleanly *replaces* whatever those wrote earlier. (Browsers key cookies by
 *    name+domain+path; differing attributes still replace, but matching them
 *    avoids confusion in DevTools and any future per-attribute heuristics.)
 */
export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) {
    throw new Error("Invalid locale");
  }

  const cookieStore = await cookies();
  const cookieOptions = {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax" as const,
    httpOnly: false,
    secure: SECURE_COOKIES,
  };
  cookieStore.set(LOCALE_COOKIE, locale, cookieOptions);
  cookieStore.set(LOCALE_EXPLICIT_COOKIE, "1", cookieOptions);

  const session = await auth();
  const userId = session?.user?.id;
  if (userId) {
    await db
      .update(users)
      .set({ preferredLocale: locale })
      .where(eq(users.id, userId));
  }

  revalidatePath("/", "layout");
}
