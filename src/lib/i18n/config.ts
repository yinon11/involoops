/**
 * i18n configuration.
 *
 * To add a new language:
 *   1. Add its code to `locales`.
 *   2. Add an entry to `localeConfig` with its display name, BCP 47 tag
 *      (used for `Intl` formatting and the `lang` attribute), and text direction.
 *   3. Create a dictionary file at `src/lib/i18n/dictionaries/<code>.ts` that
 *      satisfies the `Dictionary` type.
 *   4. Register the dictionary in `src/lib/i18n/dictionaries/index.ts`.
 */

export const locales = ["en", "he"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export interface LocaleMeta {
  /** Name shown in the language picker (written in its own language). */
  name: string;
  /** BCP 47 tag used for `<html lang>` and `Intl` formatters. */
  tag: string;
  /** Text direction. */
  dir: "ltr" | "rtl";
}

export const localeConfig: Record<Locale, LocaleMeta> = {
  en: { name: "English", tag: "en-US", dir: "ltr" },
  he: { name: "עברית", tag: "he-IL", dir: "rtl" },
};

export const LOCALE_COOKIE = "NEXT_LOCALE";
/**
 * Set alongside `NEXT_LOCALE` whenever the user explicitly picks a language
 * from the header switcher. Presence = "the user made a choice"; absence =
 * the cookie was auto-written (e.g. geo fallback) and the resolver is free
 * to override on the next request.
 */
export const LOCALE_EXPLICIT_COOKIE = "NEXT_LOCALE_SET";
/**
 * Short-lived, client-readable hint that the server just auto-selected a
 * locale for this user (first sign-in, no prior choice). A client component
 * in the app shell consumes it once to show a toast, then clears it.
 */
export const LOCALE_AUTO_SET_COOKIE = "NEXT_LOCALE_AUTO";

export function isLocale(value: string | undefined | null): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
