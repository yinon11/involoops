import "server-only";

import { cookies, headers } from "next/headers";
import {
  defaultLocale,
  LOCALE_COOKIE,
  LOCALE_EXPLICIT_COOKIE,
  isLocale,
  type Locale,
} from "./config";

/**
 * Header set by `middleware.ts` for every request whose URL contains a locale
 * prefix (`/en/...` or `/he/...`). Kept in sync with the constant of the same
 * name in `./server.ts`; duplicated here to avoid importing the Node-only
 * server module from Edge routes.
 */
export const LOCALE_REQUEST_HEADER = "x-locale";

/**
 * Edge-runtime locale resolver. Reads only request headers + cookies — no
 * `auth()`, no DB, no `node:crypto` — so Turbopack does not bundle the auth
 * stack (mfa, user-api-key, Drizzle, Anthropic SDK) into the Edge worker.
 *
 * This is sufficient for `opengraph-image.tsx` / `twitter-image.tsx` under
 * `[locale]/...` because middleware always sets the `x-locale` header for
 * those paths from the URL prefix — the strongest possible signal anyway.
 *
 * Resolution order:
 *   1. `x-locale` header (URL prefix, set by middleware).
 *   2. Explicit user pick (`NEXT_LOCALE_SET=1` + `NEXT_LOCALE`).
 *   3. Cloudflare geo header (`CF-IPCountry`).
 *   4. `Accept-Language` first tag.
 *   5. `defaultLocale`.
 *
 * Node-runtime pages should keep using `getLocale()` from `./server.ts`,
 * which adds the authenticated user's saved preference between (2) and (3).
 */
export async function getLocaleEdge(): Promise<Locale> {
  const hdrs = await headers();

  const fromUrl = hdrs.get(LOCALE_REQUEST_HEADER);
  if (isLocale(fromUrl)) return fromUrl;

  const cookieStore = await cookies();
  const explicit = cookieStore.get(LOCALE_EXPLICIT_COOKIE)?.value === "1";
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  if (explicit && isLocale(cookieLocale)) return cookieLocale;

  const geo = localeFromGeo(hdrs.get("cf-ipcountry"));
  if (geo) return geo;

  const accept = localeFromAcceptLanguage(hdrs.get("accept-language"));
  if (accept) return accept;

  return defaultLocale;
}

function localeFromGeo(country: string | null | undefined): Locale | null {
  if (!country) return null;
  const upper = country.toUpperCase();
  if (upper === "XX" || upper === "T1") return null;
  return upper === "IL" ? "he" : "en";
}

function localeFromAcceptLanguage(
  header: string | null | undefined,
): Locale | null {
  if (!header) return null;
  const first = header.split(",")[0]?.trim().split(";")[0]?.trim().toLowerCase();
  if (!first) return null;
  const primary = first.split("-")[0];
  return primary === "he" ? "he" : "en";
}
