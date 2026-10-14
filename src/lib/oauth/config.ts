import { SCOPES, type Scope } from "@/lib/api/scopes";

/** Hosted Claude surfaces (Claude.ai, Desktop, mobile, Cowork). */
export const CLAUDE_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

const OIDC_SCOPES = ["openid", "offline_access"] as const;

export function oauthIssuer(): string | null {
  const raw = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function mcpResourceIndicator(): string {
  const issuer = oauthIssuer();
  if (!issuer) throw new Error("OAuth issuer is not configured");
  return `${issuer}/api/mcp`;
}

/**
 * OAuth is off until a real client secret is present. The example value in
 * `.env.example` is intentionally too short to turn this on.
 */
export function oauthConfigured(): boolean {
  const secret = process.env.ANTHROPIC_MCP_CLIENT_SECRET?.trim() ?? "";
  return Boolean(
    oauthIssuer() &&
      process.env.AUTH_SECRET &&
      process.env.ANTHROPIC_MCP_CLIENT_ID?.trim() &&
      secret.length >= 32,
  );
}

export function oauthClientId(): string {
  const id = process.env.ANTHROPIC_MCP_CLIENT_ID?.trim();
  if (!id) throw new Error("ANTHROPIC_MCP_CLIENT_ID is not set");
  return id;
}

export function oauthRedirectUris(): string[] {
  const extras = (process.env.OAUTH_DEV_REDIRECT_URIS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(isAllowedDevRedirect);
  return [CLAUDE_REDIRECT_URI, ...extras];
}

/**
 * Redirects a dynamically registered client may use.
 * Hosted Claude uses one fixed callback. Claude Code uses RFC 8252
 * loopback with an ephemeral port and the path `/callback`.
 */
export function isAllowedOauthRedirect(uri: string): boolean {
  if (uri === CLAUDE_REDIRECT_URI) return true;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== "/callback") return false;
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return false;
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  }
  return true;
}

function isAllowedDevRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

export function supportedOidcScopes(): readonly string[] {
  return OIDC_SCOPES;
}

export function supportedResourceScopes(): readonly Scope[] {
  return SCOPES;
}

/** Plain-language labels for the consent screen. */
export const SCOPE_LABELS: Record<string, string> = {
  "me:read": "Read your account profile",
  "outbound:read": "Read invoices you issue",
  "outbound:write": "Create and edit invoice drafts",
  "outbound:issue": "Issue, send, and credit invoices on your behalf",
  "customers:read": "Read your customers",
  "customers:write": "Create and edit customers",
  "templates:read": "Read your invoice templates",
  "templates:write": "Edit your invoice templates",
  "invoices:read": "Read your expenses and incoming invoices",
  "invoices:write": "Edit expenses and incoming invoices",
  "vendors:read": "Read your vendors",
  "vendors:write": "Create and edit vendors",
  "uploads:write": "Upload invoice files",
  "audit:read": "Read the audit log",
  "archive:read": "Read archived documents",
  "shaam:read": "Read tax-authority submission status",
  "webhooks:write": "Manage webhooks",
  openid: "Identify you",
  offline_access: "Stay connected without signing in again",
};
