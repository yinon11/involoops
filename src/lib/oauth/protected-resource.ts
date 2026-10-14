import { SCOPES } from "@/lib/api/scopes";
import { oauthConfigured, oauthIssuer } from "./config";

/**
 * RFC 9728 protected-resource metadata for `/api/mcp`.
 * Served at the root well-known path and at the path-suffixed fallback
 * Claude probes (`/.well-known/oauth-protected-resource/api/mcp`).
 * `resource` is always the MCP URL, not the metadata URL.
 */
export function protectedResourceDocument(req: Request): Record<string, unknown> {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const origin =
    forwardedProto && forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : url.origin;
  const issuer = oauthConfigured() ? oauthIssuer() : null;
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: issuer ? [issuer] : [],
    bearer_methods_supported: ["header"],
    scopes_supported: [...SCOPES],
    resource_documentation: `${origin}/developers`,
  };
}

export function protectedResourceResponse(req: Request): Response {
  return Response.json(protectedResourceDocument(req), {
    headers: {
      "cache-control": "max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
