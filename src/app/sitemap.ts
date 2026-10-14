import type { MetadataRoute } from "next";
import { tutorials } from "./[locale]/learn/tutorials";
import { locales, defaultLocale } from "@/lib/i18n/config";
import { listGuideArticles } from "@/lib/user-guide";

/**
 * Per-locale sitemap entry with `alternates.languages` pointing at the
 * other locale variants. Google reads these to understand the URL set is a
 * translation pair, not duplicate content.
 *
 * `path` is the locale-less slug (e.g. `/contact`, `/`); the helper expands
 * it into `/{locale}{path}` for each supported locale.
 */
type SitemapEntry = MetadataRoute.Sitemap[number];

function localizedEntries(
  siteUrl: string,
  path: string,
  meta: Pick<SitemapEntry, "lastModified" | "changeFrequency" | "priority">,
): MetadataRoute.Sitemap {
  const buildUrl = (locale: string) =>
    path === "/" ? `${siteUrl}/${locale}` : `${siteUrl}/${locale}${path}`;

  const languages = Object.fromEntries(
    locales.map((l) => [l, buildUrl(l)]),
  ) as Record<string, string>;
  // x-default points at the canonical-language variant so Google has a
  // fallback when none of the user's preferred languages match.
  languages["x-default"] = buildUrl(defaultLocale);

  return locales.map((locale) => ({
    url: buildUrl(locale),
    ...meta,
    alternates: { languages },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://localhost:3000";
  const now = new Date();

  return [
    // Brand front door — top of the funnel for both products. Two entries
    // (one per locale) with cross-references via alternates.languages.
    ...localizedEntries(siteUrl, "/", {
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    }),
    // Developer surfaces — English-only by design (see developers/layout.tsx),
    // not under /[locale] so no hreflang alternates. /developers/swagger is
    // intentionally excluded (noindex) and /developers/reference 308-redirects
    // to /developers/swagger so we don't ship it either.
    {
      url: `${siteUrl}/developers`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/developers/guide`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...listGuideArticles().map((article) => ({
      url: `${siteUrl}${article.href}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    // Auth pages stay out of the sitemap — they're noindexed too. Marketing
    // intent is owned by the home page (Studio and Insights both live there).
    ...localizedEntries(siteUrl, "/contact", {
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    }),
    ...localizedEntries(siteUrl, "/accessibility", {
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    }),
    ...localizedEntries(siteUrl, "/license", {
      lastModified: new Date("2026-10-12"),
      changeFrequency: "yearly",
      priority: 0.4,
    }),
    ...localizedEntries(siteUrl, "/privacy", {
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    }),
    ...localizedEntries(siteUrl, "/terms", {
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    }),
    // /learn index + each tutorial detail page. Tutorial content is static
    // dictionary copy today, so `lastModified` tracks deploys (now). When we
    // gain a CMS-backed `dateModified`, swap `now` for that.
    ...localizedEntries(siteUrl, "/learn", {
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    }),
    ...tutorials.flatMap((tut) =>
      localizedEntries(siteUrl, `/learn/${tut.slug}`, {
        lastModified: now,
        changeFrequency: "monthly",
        priority: 0.6,
      }),
    ),
  ];
}
