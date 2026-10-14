import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://localhost:3000";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Authenticated app surfaces — bot follows would 302 to /login and
          // waste crawl budget on nothing useful.
          "/dashboard",
          "/invoices",
          "/pending",
          "/duplicates",
          "/income",
          "/profit",
          "/vendors",
          "/outbound",
          "/money-in",
          "/money-out",
          "/projects",
          "/clients",
          "/customers",
          "/creator",
          "/review",
          "/settings",
          "/export",
          "/admin",
          "/tutorials",
          // Auth funnels are intentionally noindexed via metadata; this just
          // saves the crawler the round-trip.
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
          "/welcome",
          "/invite",
          "/consent",
          "/oauth/",
          // Public verify landing for individual signed invoices — noindexed
          // per page; mirrored here so crawlers don't even try the URL space.
          "/verify/",
          // Interactive Swagger UI — noindexed; the canonical machine-readable
          // surface is /api/v1/openapi.json.
          "/developers/swagger",
          // All API routes (REST, webhooks, cron, file proxies). Bots have
          // no business hitting them.
          "/api/",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
