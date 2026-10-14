import { protectedResourceResponse } from "@/lib/oauth/protected-resource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 9728 metadata at `/.well-known/oauth-protected-resource`. */
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
