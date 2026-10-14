import { protectedResourceResponse } from "@/lib/oauth/protected-resource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Path-inserted metadata (`/.well-known/oauth-protected-resource/api/mcp`).
 * Claude probes this before the root document when a 401 has no
 * `resource_metadata` parameter. Same JSON as the root document.
 */
export async function GET(req: Request) {
  return protectedResourceResponse(req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "*",
      "access-control-max-age": "86400",
    },
  });
}
