import "server-only";

import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import {
  defaultLocale,
  LOCALE_COOKIE,
  LOCALE_EXPLICIT_COOKIE,
  isLocale,
  localeConfig,
  type Locale,
} from "./config";
import { dictionaries, type Dictionary } from "./dictionaries";

/**
 * Header set by middleware when the request URL contains a locale prefix
 * (`/en/...` or `/he/...`). The URL prefix is the strongest possible signal —
 * it's what search engines indexed and what the user (or a crawler) typed —
 * so it overrides every cookie / DB / geo signal below.
 */
export const LOCALE_REQUEST_HEADER = "x-locale";

/**
 * Resolution order for the active locale. The first branch that returns a
 * value wins; a `null` means "no signal here, try the next one".
 *
 *   1. URL prefix (`x-locale` header set by `middleware.ts` for `/en/...` and
 *      `/he/...`). Hard override — search engines + share links should always
 *      render the language they advertised, not whatever cookie the visitor
 *      brought with them.
 *   2. Explicit cookie — the user clicked the header picker on THIS device
 *      (`NEXT_LOCALE_SET=1`). Treated as a device-local override so a fresh
 *      pick is reflected immediately, without waiting for the JWT cache (the
 *      `preferredLocale` claim is only refreshed every ~10 min — see `auth.ts`).
 *   3. Authenticated user's saved preference (`users.preferred_locale`) —
 *      the cross-device default for users who haven't picked on this device.
 *   4. Cloudflare geo header (`CF-IPCountry`): `IL` → Hebrew, otherwise English.
 *   5. `Accept-Language` header fallback (when `CF-IPCountry` is missing, e.g.
 *      local dev without Cloudflare in front).
 *   6. `defaultLocale` from config.
 *
 * The DB lookup is deliberately lazy and swallows its own errors — the root
 * layout calls `getLocale()` on every request, including marketing pages, and
 * we don't want an Auth.js or Postgres blip to blank out the UI.
 */
export async function getLocale(): Promise<Locale> {
  const hdrs = await headers();
  const fromUrl = hdrs.get(LOCALE_REQUEST_HEADER);
  if (isLocale(fromUrl)) return fromUrl;

  const cookieStore = await cookies();
  const explicit = cookieStore.get(LOCALE_EXPLICIT_COOKIE)?.value === "1";
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  if (explicit && isLocale(cookieLocale)) {
    return cookieLocale;
  }

  const fromUser = await localeFromUser();
  if (fromUser) return fromUser;

  return localeFromRequest();
}

async function localeFromUser(): Promise<Locale | null> {
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    const stored = session?.user?.preferredLocale;
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Locale inferred from request-only signals (no session, no explicit cookie).
 * Exported so the sign-in event can call it to backfill the DB on first login.
 */
export async function localeFromRequest(): Promise<Locale> {
  const hdrs = await headers();
  const geo = localeFromGeo(hdrs.get("cf-ipcountry"));
  if (geo) return geo;

  const acceptLanguage = localeFromAcceptLanguage(hdrs.get("accept-language"));
  if (acceptLanguage) return acceptLanguage;

  return defaultLocale;
}

function localeFromGeo(country: string | null | undefined): Locale | null {
  if (!country) return null;
  const upper = country.toUpperCase();
  // Cloudflare returns "XX" for unknown and "T1" for Tor — treat as no signal
  // so we fall through to Accept-Language rather than forcing English.
  if (upper === "XX" || upper === "T1") return null;
  return upper === "IL" ? "he" : "en";
}

function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  // Parse the first tag only — the browser already orders by preference.
  // "he-IL,he;q=0.9,en;q=0.8" → "he"
  const first = header.split(",")[0]?.trim().split(";")[0]?.trim().toLowerCase();
  if (!first) return null;
  const primary = first.split("-")[0];
  return primary === "he" ? "he" : "en";
}

/**
 * Read the preferred locale for a specific user id, bypassing the session.
 * Used by the sign-in event so we don't need a second round-trip through
 * `auth()` right as the JWT is being minted.
 */
export async function getStoredLocaleForUser(
  userId: string,
): Promise<Locale | null> {
  try {
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const row = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { preferredLocale: true },
    });
    const stored = row?.preferredLocale;
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Return the dictionary for the active locale. */
export async function getDictionary(): Promise<Dictionary> {
  const locale = await getLocale();
  return dictionaries[locale];
}

/** Return the BCP 47 tag (`en-US`, `he-IL`, …) for the active locale. */
export async function getLocaleTag(): Promise<string> {
  const locale = await getLocale();
  return localeConfig[locale].tag;
}
