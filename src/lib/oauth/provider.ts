import { createServer, type IncomingMessage } from "node:http";
import { eq } from "drizzle-orm";
import { errors, Provider } from "oidc-provider";
import { db } from "@/db";
import { users } from "@/db/schema";
import { OauthAdapter } from "./adapter";
import {
  mcpResourceIndicator,
  oauthClientId,
  oauthConfigured,
  oauthIssuer,
  isAllowedOauthRedirect,
  oauthRedirectUris,
  supportedOidcScopes,
  supportedResourceScopes,
} from "./config";
import { parseJwks } from "./jwks";

const ACCESS_TOKEN_TTL = 60 * 60;
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

type GlobalOidc = typeof globalThis & {
  __involoopsOidc?: Provider;
  __involoopsOidcPort?: Promise<number>;
};

function createProvider(): Provider {
  const issuer = oauthIssuer();
  const secret = process.env.AUTH_SECRET;
  const clientSecret = process.env.ANTHROPIC_MCP_CLIENT_SECRET?.trim();
  const jwksRaw = process.env.OAUTH_JWKS?.trim() ?? "";
  const jwks = jwksRaw ? parseJwks(jwksRaw) : null;
  if (!issuer || !secret || !clientSecret || !jwks) {
    throw new Error(
      issuer && secret && clientSecret
        ? "OAuth provider is not configured: OAUTH_JWKS is not set"
        : "OAuth provider is not configured",
    );
  }
  const resource = mcpResourceIndicator();
  const secure = issuer.startsWith("https:");

  const provider = new Provider(issuer, {
    adapter: OauthAdapter,
    jwks,
    clients: [
      {
        client_id: oauthClientId(),
        client_secret: clientSecret,
        client_name: "Claude",
        redirect_uris: oauthRedirectUris(),
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        // Body secret and HTTP Basic are both accepted for this method.
        token_endpoint_auth_method: "client_secret_post",
        scope: [...supportedResourceScopes(), ...supportedOidcScopes()].join(" "),
        application_type: "web",
      },
    ],
    scopes: [...supportedOidcScopes(), ...supportedResourceScopes()],
    responseTypes: ["code"],
    clientAuthMethods: ["client_secret_post", "client_secret_basic", "none"],
    pkce: {
      required: () => true,
    },
    rotateRefreshToken(ctx: {
      oidc: {
        entities: {
          Client?: { clientAuthMethod?: string };
          RefreshToken?: {
            totalLifetime: () => number;
            ttlPercentagePassed: () => number;
          };
        };
      };
    }) {
      const { Client: client, RefreshToken: refreshToken } = ctx.oidc.entities;
      if (!refreshToken) return false;
      if (refreshToken.totalLifetime() >= 365.25 * 24 * 60 * 60) return false;
      // Public clients (token auth "none") must rotate on every refresh.
      if (client?.clientAuthMethod === "none") return true;
      return refreshToken.ttlPercentagePassed() >= 70;
    },
    interactions: {
      url(_ctx: unknown, interaction: { uid: string }) {
        return `/oauth/interaction/${interaction.uid}`;
      },
    },
    features: {
      devInteractions: { enabled: false },
      revocation: { enabled: true },
      introspection: { enabled: true },
      registration: {
        enabled: true,
        initialAccessToken: false,
      },
      registrationManagement: { enabled: true },
      resourceIndicators: {
        enabled: true,
        async defaultResource(
          _ctx: unknown,
          _client: unknown,
          oneOf?: readonly string[],
        ) {
          if (oneOf?.length) {
            return oneOf.includes(resource) ? resource : undefined;
          }
          return resource;
        },
        async getResourceServerInfo(_ctx: unknown, indicator: string) {
          if (indicator !== resource) {
            throw new errors.InvalidTarget();
          }
          return {
            scope: supportedResourceScopes().join(" "),
            audience: resource,
            accessTokenFormat: "opaque" as const,
            accessTokenTTL: ACCESS_TOKEN_TTL,
          };
        },
        async useGrantedResource() {
          return true;
        },
      },
    },
    ttl: {
      AccessToken: ACCESS_TOKEN_TTL,
      AuthorizationCode: 60,
      RefreshToken: REFRESH_TOKEN_TTL,
      Grant: REFRESH_TOKEN_TTL,
      Session: 14 * 24 * 60 * 60,
      Interaction: 60 * 60,
    },
    cookies: {
      keys: [secret],
      long: { httpOnly: true, sameSite: "lax", secure },
      short: { httpOnly: true, sameSite: "lax", secure },
    },
    routes: {
      authorization: "/oauth/authorize",
      token: "/oauth/token",
      jwks: "/oauth/jwks",
      introspection: "/oauth/introspect",
      revocation: "/oauth/revoke",
      registration: "/oauth/reg",
      userinfo: "/oauth/userinfo",
      end_session: "/oauth/session/end",
      pushed_authorization_request: "/oauth/request",
    },
    discovery: {
      service_documentation: `${issuer}/developers`,
    },
    async findAccount(_ctx: unknown, id: string) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
        columns: { id: true, email: true, name: true },
      });
      if (!user) return undefined;
      return {
        accountId: user.id,
        async claims() {
          return {
            sub: user.id,
            email: user.email,
            name: user.name ?? undefined,
          };
        },
      };
    },
    clientBasedCORS() {
      return false;
    },
  });
  provider.proxy = true;
  const events = provider as unknown as {
    on: (event: "server_error", listener: (ctx: unknown, err: unknown) => void) => void;
  };
  events.on("server_error", (_ctx, err) => {
    const message = err instanceof Error ? err.message : "unknown";
    console.error(`oidc server_error: ${message}`);
  });
  restrictDynamicRedirects(provider);
  return provider;
}

/**
 * The pre-registered confidential client is validated before this runs.
 * Clients created afterwards (dynamic registration and later updates) may
 * only use the Claude callback or a loopback `/callback`.
 */
function restrictDynamicRedirects(provider: Provider): void {
  const Schema = (
    provider.Client as unknown as {
      Schema: {
        prototype: {
          redirectUris: (
            this: {
              redirect_uris?: string[];
              invalidate: (message: string) => void;
            },
            uris?: string[],
            label?: string,
          ) => void;
        };
      };
    }
  ).Schema;
  const original = Schema.prototype.redirectUris;
  if (typeof original !== "function") {
    throw new Error("oidc-provider Client.Schema.redirectUris is missing");
  }
  Schema.prototype.redirectUris = function redirectUris(uris, label) {
    original.call(this, uris, label);
    const list = uris ?? this.redirect_uris ?? [];
    for (const uri of list) {
      if (!isAllowedOauthRedirect(uri)) {
        this.invalidate(
          `${label ?? "redirect_uris"} contains a URI that is not allowed`,
        );
      }
    }
  };
}

export function getOidcProvider(): Provider {
  if (!oauthConfigured()) {
    throw new Error("OAuth provider is not configured");
  }
  const g = globalThis as GlobalOidc;
  if (!g.__involoopsOidc) {
    g.__involoopsOidc = createProvider();
  }
  return g.__involoopsOidc;
}

/**
 * oidc-provider drops `offline_access` unless the authorize request includes
 * `prompt=consent` (OpenID Connect Core §11). Claude requests `offline_access`
 * without that parameter. Adding it here keeps the refresh-token scope and
 * shows the consent screen, which that scope requires.
 */
function keepOfflineAccess(req: IncomingMessage): void {
  const raw = req.url;
  if (!raw?.startsWith("/oauth/authorize?")) return;
  const url = new URL(raw, "http://127.0.0.1");
  const scopes = (url.searchParams.get("scope") ?? "").split(" ");
  if (!scopes.includes("offline_access")) return;
  const prompts = new Set(
    (url.searchParams.get("prompt") ?? "").split(" ").filter(Boolean),
  );
  if (prompts.has("consent")) return;
  prompts.add("consent");
  url.searchParams.set("prompt", [...prompts].join(" "));
  req.url = `${url.pathname}${url.search}`;
}

export async function oidcListenPort(): Promise<number> {
  const g = globalThis as GlobalOidc;
  if (!g.__involoopsOidcPort) {
    g.__involoopsOidcPort = new Promise((resolve, reject) => {
      const handle = getOidcProvider().callback();
      const server = createServer((req, res) => {
        keepOfflineAccess(req);
        handle(req, res);
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("OAuth listener did not bind a port"));
          return;
        }
        resolve(address.port);
      });
      server.on("error", reject);
    });
  }
  return g.__involoopsOidcPort;
}
