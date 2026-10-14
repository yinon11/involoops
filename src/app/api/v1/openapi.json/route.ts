import { NextResponse, type NextRequest } from "next/server";
import { getOpenApiSpec } from "@/lib/api/openapi";
import { readOrCreateRequestId } from "@/lib/api/request-id";

export const runtime = "nodejs";

/**
 * Public OpenAPI 3.1 spec. No auth — clients use this to drive code
 * generation and the rendered docs page. The base spec is cached in
 * memory by `getOpenApiSpec`; we pass the current request origin so the
 * `servers` block advertises the host actually serving the docs (e.g.
 * sandbox or localhost) as the default — otherwise Swagger UI's "Try
 * it out" panel would fire requests at production from non-prod
 * environments.
 *
 * Because the response now varies by host, we drop the public
 * Cache-Control to keep CDNs from serving the wrong origin's spec.
 */
export async function GET(req: NextRequest) {
  const requestId = readOrCreateRequestId(req);
  const origin = resolveRequestOrigin(req);
  const spec = getOpenApiSpec(origin);
  return NextResponse.json(spec, {
    status: 200,
    headers: {
      "x-request-id": requestId,
      "cache-control": "private, max-age=60",
      vary: "Host, X-Forwarded-Host, X-Forwarded-Proto",
      // Help cross-origin Scalar / SDK generators load it without CORS hassle.
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    },
  });
}

/**
 * Reconstruct the public-facing origin even when we sit behind a TLS
 * terminator that hands us `http://` internally. Mirrors the same
 * pattern `src/auth.ts` uses for cookie security.
 */
function resolveRequestOrigin(req: NextRequest): string | null {
  try {
    const forwardedHost =
      req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const forwardedProto =
      req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
    if (!forwardedHost) return new URL(req.url).origin;
    return `${forwardedProto}://${forwardedHost}`;
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      "access-control-max-age": "600",
    },
  });
}
