import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { getPublicOrigin } from "@/lib/mcp/public-origin";
import { verifyMcpBearer } from "@/lib/mcp/auth";
import { oauthConfigured } from "@/lib/oauth/config";
import { SCOPES } from "@/lib/api/scopes";
import { registerInvoloopsTools } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * InvoLoops MCP endpoint (Streamable HTTP).
 *
 * Auth: bearer API keys (`inv_live_…` / `inv_test_…`) or an OAuth access
 * token from `/oauth/authorize` when `ANTHROPIC_MCP_CLIENT_*` is set.
 *
 * Clients (Cursor, Claude, etc.) point at:
 *   https://<host>/api/mcp
 * with the Authorization header set to a key that has the scopes
 * needed by the tools they call.
 *
 * See docs/api/10-mcp.md.
 *
 * Built on `@modelcontextprotocol/server` directly (not `mcp-handler`) so we
 * do not pollute the global `Request` type with MCP `auth` — that conflicts
 * with Auth.js middleware typing.
 */

const INSTRUCTIONS =
  "InvoLoops MCP server. Users connect by signing in to their InvoLoops account (OAuth). " +
  "API keys (Settings → API Keys) are also supported for direct API use. " +
  "For business health / expenses / overspend questions start with " +
  "get_business_status (needs invoices:read), then get_spend_by_vendor or " +
  "get_spend_insights, and list_inbound_invoices to drill down. " +
  "For issuing invoices: create_outbound_invoice_draft → " +
  "update_outbound_invoice_draft (fix before issue) → " +
  "issue_outbound_invoice → send_outbound_invoice (outbound:* scopes). " +
  "Unwanted drafts: delete_outbound_invoice_draft (outbound:write; drafts only). " +
  "Reverse an issued invoice: issue_outbound_credit_note (outbound:issue). " +
  "Other tools cover customers, templates, vendors list, and me/business entity.";

const mcp = createMcpHandler(
  () => {
    const server = new McpServer(
      { name: "InvoLoops", version: "1.0.0" },
      { instructions: INSTRUCTIONS },
    );
    registerInvoloopsTools(server);
    return server;
  },
  {
    legacy: "stateless",
    onerror: (err) => {
      console.error("[mcp]", err);
    },
  },
);

async function handle(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  const token =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

  const authInfo = await verifyMcpBearer(req, token);
  if (!authInfo) {
    const origin = getPublicOrigin(req);
    const challenge = [
      `Bearer realm="involoops-mcp"`,
      `error="invalid_token"`,
      `resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    ];
    if (oauthConfigured()) {
      challenge.push(`scope="${SCOPES.join(" ")}"`);
    }
    return new Response(
      JSON.stringify({
        error: "invalid_token",
        error_description: oauthConfigured()
          ? "Missing or invalid bearer token. Use an InvoLoops API key (inv_live_… / inv_test_…) or an OAuth access token. See /developers."
          : "Missing or invalid InvoLoops API key. Pass Authorization: Bearer inv_live_… (or inv_test_…). See /developers.",
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": challenge.join(", "),
          "access-control-allow-origin": "*",
        },
      },
    );
  }

  return mcp.fetch(req, { authInfo });
}

export { handle as GET, handle as POST };

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers":
        "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID, X-Request-Id",
      "access-control-max-age": "86400",
    },
  });
}
