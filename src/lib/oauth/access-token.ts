import { eq } from "drizzle-orm";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { parseScopes } from "@/lib/api/scopes";
import type { ApiKeyMode } from "@/lib/api/key-format";
import { oauthConfigured } from "./config";
import { getOidcProvider } from "./provider";

const OAUTH_MODE: ApiKeyMode = "live";

/**
 * Resolve an opaque access token to the same MCP auth extra API keys use.
 * Returns undefined when the token is missing, expired, or the account is gone.
 */
export async function verifyOauthAccessToken(
  token: string,
): Promise<AuthInfo | undefined> {
  if (!oauthConfigured()) return undefined;
  try {
    const accessToken = await getOidcProvider().AccessToken.find(token);
    if (!accessToken?.accountId) return undefined;
    if (
      typeof accessToken.exp === "number" &&
      accessToken.exp * 1000 <= Date.now()
    ) {
      return undefined;
    }
    const user = await db.query.users.findFirst({
      where: eq(users.id, accessToken.accountId),
      columns: { id: true, email: true, name: true },
    });
    if (!user) return undefined;
    const scopes = parseScopes((accessToken.scope ?? "").split(" "));
    const clientId = accessToken.clientId ?? "oauth";
    return {
      token,
      clientId,
      scopes,
      extra: {
        involoops: {
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
          apiKeyId: `oauth:${clientId}`,
          apiKeyName: "Claude",
          apiKeyMode: OAUTH_MODE,
          apiKeyPublicId: clientId,
        },
      },
    };
  } catch (err) {
    console.error("[mcp-auth] oauth", err);
    return undefined;
  }
}
