import type { AuthInfo } from "@modelcontextprotocol/server";
import {
  authenticateApiKey,
  type ApiAuthContext,
} from "@/lib/api/authenticate";
import { ApiError, apiErrors } from "@/lib/api/errors";
import { clientIpFromRequest } from "@/lib/rate-limit";
import type { Scope } from "@/lib/api/scopes";
import { parseApiKey, type ApiKeyMode } from "@/lib/api/key-format";
import { verifyOauthAccessToken } from "@/lib/oauth/access-token";

const EXTRA_KEY = "involoops";

export interface McpAuthExtra {
  userId: string;
  userEmail: string;
  userName: string | null;
  apiKeyId: string;
  apiKeyName: string;
  apiKeyMode: ApiKeyMode;
  apiKeyPublicId: string;
}

/**
 * MCP bearer auth. API keys (`inv_live_` / `inv_test_`) keep their existing
 * path. Anything else is an OAuth access token when the authorization server
 * is configured.
 */
export async function verifyMcpBearer(
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  if (parseApiKey(bearerToken)) {
    return verifyMcpApiKey(req, bearerToken);
  }
  return verifyOauthAccessToken(bearerToken);
}

/**
 * Verify an InvoLoops API key for MCP (`Authorization: Bearer inv_live_…`).
 * Returns `undefined` on any auth failure so the route can 401.
 */
export async function verifyMcpApiKey(
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  try {
    const ctx = await authenticateApiKey({
      authorizationHeader: `Bearer ${bearerToken}`,
      ip: clientIpFromRequest(req),
      required: [],
    });
    return authInfoFromContext(ctx, bearerToken);
  } catch (err) {
    if (err instanceof ApiError) return undefined;
    console.error("[mcp-auth] unexpected", err);
    return undefined;
  }
}

export function authInfoFromContext(
  ctx: ApiAuthContext,
  token: string,
): AuthInfo {
  const extra: McpAuthExtra = {
    userId: ctx.user.id,
    userEmail: ctx.user.email,
    userName: ctx.user.name,
    apiKeyId: ctx.apiKey.id,
    apiKeyName: ctx.apiKey.name,
    apiKeyMode: ctx.apiKey.mode,
    apiKeyPublicId: ctx.apiKey.publicId,
  };
  return {
    token,
    clientId: ctx.apiKey.publicId,
    scopes: ctx.apiKey.scopes,
    extra: { [EXTRA_KEY]: extra },
  };
}

type ToolCtx = {
  http?: { authInfo?: AuthInfo };
};

/**
 * Resolve the authenticated API-key context for a tool call and enforce
 * the required scopes (deny-by-default, same catalog as `/api/v1`).
 */
export function requireMcpAuth(
  ctx: ToolCtx,
  required: readonly Scope[],
): { userId: string; scopes: Scope[]; extra: McpAuthExtra } {
  const authInfo = ctx.http?.authInfo;
  if (!authInfo) throw apiErrors.missingCredentials();

  const scopes = authInfo.scopes as Scope[];
  for (const need of required) {
    if (!scopes.includes(need)) {
      throw apiErrors.missingScope([...required], scopes);
    }
  }

  const packed = authInfo.extra?.[EXTRA_KEY];
  if (!isMcpAuthExtra(packed)) {
    throw apiErrors.invalidKey();
  }

  return { userId: packed.userId, scopes, extra: packed };
}

function isMcpAuthExtra(value: unknown): value is McpAuthExtra {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    typeof v.userEmail === "string" &&
    typeof v.apiKeyId === "string" &&
    typeof v.apiKeyPublicId === "string"
  );
}
