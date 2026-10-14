/**
 * Internal route paths under /developers. Centralised so the guide,
 * sidebar, top-bar, and anchor builders all agree.
 */
export const ROUTE_PATHS = {
  guide: "/developers",
  userGuide: "/developers/guide",
  swagger: "/developers/swagger",
  playground: "/developers/playground",
  openapiSpec: "/api/v1/openapi.json",
} as const;
