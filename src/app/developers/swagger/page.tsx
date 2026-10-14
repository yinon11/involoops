import type { Metadata } from "next";
import { SwaggerUiEmbed } from "./swagger-embed";
import { ROUTE_PATHS } from "../_components/_routes";
import { buildMetadata } from "@/lib/seo/metadata";

// Interactive tool that requires an API key to be useful — no SEO value, and
// indexing the Swagger UI shell would just dilute the /developers page. The
// raw OpenAPI JSON at /api/v1/openapi.json is the canonical machine-readable
// surface for crawlers that want one.
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/developers/swagger",
    noindex: true,
    localized: false,
    copy: {
      en: {
        title: "API Reference (Swagger)",
        description:
          "Interactive Swagger UI rendering of the InvoLoops OpenAPI 3.1 spec. Try every endpoint live with your API key.",
      },
    },
  });
}

/**
 * Interactive API reference — Swagger UI loaded from the official jsDelivr
 * CDN, reading our own `/api/v1/openapi.json`. This is the only renderer
 * the developer site ships now (the previous Scalar page redirects here).
 *
 * Deep-link anchors built by `swaggerUiUrl()` use the explicit
 * `operationId` set on every operation in `src/lib/api/openapi.ts`, so
 * links from the Guide land on the exact endpoint.
 */
export default function SwaggerPage() {
  return <SwaggerUiEmbed specUrl={ROUTE_PATHS.openapiSpec} />;
}
