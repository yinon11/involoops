import "server-only";

import type { Metadata } from "next";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { localeConfig, type Locale } from "@/lib/i18n";

const FALLBACK_SITE_URL = "https://localhost:3000";

/**
 * Resolve the canonical site origin once, lazily.
 *
 * Uses NEXT_PUBLIC_SITE_URL (origin only — no trailing slash). Falls back to
 * https://localhost:3000 in dev so `new URL(...)` doesn't throw on missing env.
 */
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE_URL;
}

export interface SeoCopy {
  /** Page <title>. The `%s | InvoLoops` template applies via the root layout. */
  title: string;
  description: string;
}

export interface BuildMetadataInput {
  /**
   * Site-relative path WITHOUT a locale prefix, must start with `/`.
   * E.g. `/contact` — the helper expands it to `/en/contact`, `/he/contact`,
   * etc. Use `/` for the home page (which becomes `/en` and `/he`).
   */
  path: string;
  /** Per-locale title + description. EN is required; HE optional (falls back to EN). */
  copy: Partial<Record<Locale, SeoCopy>> & { en: SeoCopy };
  /** Override robots — defaults to indexable. Pass `noindex: true` to suppress. */
  noindex?: boolean;
  /**
   * Pages that aren't under the `[locale]` segment (auth, /developers,
   * /verify) opt out of locale-prefixed URL generation by passing
   * `localized: false`. The helper then emits the bare `path` as canonical
   * and skips `alternates.languages`.
   */
  localized?: boolean;
}

/**
 * Build a fully-qualified URL for a given locale + un-prefixed path. Lifted
 * out so the sitemap can reuse the same convention.
 *
 *   buildLocalizedUrl("/contact", "he") → https://involoops.com/he/contact
 *   buildLocalizedUrl("/", "en")        → https://involoops.com/en
 */
export function buildLocalizedUrl(path: string, locale: Locale): string {
  const siteUrl = getSiteUrl();
  if (path === "/") return `${siteUrl}/${locale}`;
  return `${siteUrl}/${locale}${path}`;
}

/**
 * Site-relative locale-prefixed path for `<Link href>`.
 *
 *   localePath("/contact", "he") → "/he/contact"
 *   localePath("/", "en")        → "/en"
 */
export function localePath(path: string, locale: Locale): string {
  if (path === "/") return `/${locale}`;
  return `/${locale}${path}`;
}

/**
 * Build a consistent `Metadata` object for any public page.
 *
 * Centralises the boring boilerplate (canonical, OG, Twitter, hreflang,
 * locale tag) so individual pages only state what's unique about them.
 * The root layout still owns site-wide defaults (icons, manifest,
 * applicationName, formatDetection) — this helper only fills per-page slots.
 */
export async function buildMetadata(input: BuildMetadataInput): Promise<Metadata> {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const siteUrl = getSiteUrl();
  const tag = localeConfig[locale].tag;

  const copy = input.copy[locale] ?? input.copy.en;
  const localized = input.localized ?? true;

  const canonical = localized
    ? buildLocalizedUrl(input.path, locale)
    : `${siteUrl}${input.path}`;

  const languages = localized
    ? {
        en: buildLocalizedUrl(input.path, "en"),
        he: buildLocalizedUrl(input.path, "he"),
        "x-default": buildLocalizedUrl(input.path, "en"),
      }
    : undefined;

  return {
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical,
      ...(languages ? { languages } : {}),
    },
    openGraph: {
      title: copy.title,
      description: copy.description,
      url: canonical,
      type: "website",
      locale: tag.replace("-", "_"),
      siteName: dict.common.appName,
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
    },
    ...(input.noindex
      ? { robots: { index: false, follow: false } }
      : { robots: { index: true, follow: true } }),
  };
}
