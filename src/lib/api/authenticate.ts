import type { NextRequest } from "next/server";
import { db } from "@/db";
import { apiKeys, users, type ApiKeyRow } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { ApiError, apiErrors } from "./errors";
import {
  hashSecret,
  parseApiKey,
  secretMatches,
  type ApiKeyMode,
} from "./key-format";
import {
  enforceApiKeyLimits,
  enforceAuthFailureBrake,
  rateLimitHeaders,
  type ApiKeyRateLimitDecision,
} from "./rate-limit";
import { clientIpFromRequest } from "@/lib/rate-limit";
import type { Scope } from "./scopes";
import {
  authenticateDeviceAccess,
  isDeviceAccessToken,
} from "./device-session";

/** Resolved request-scoped context handed to route handlers. */
export interface ApiAuthContext {
  user: { id: string; email: string; name: string | null };
  /**
   * `api_key` is a dashboard key (`inv_live_` / `inv_test_`).
   * `device` is a phone access token. Upload jobs must not store a
   * device session id in `api_key_id` — that column references `api_keys`.
   */
  credential: "api_key" | "device";
  apiKey: {
    id: string;
    name: string;
    mode: ApiKeyMode;
    scopes: Scope[];
    publicId: string;
  };
  ip: string;
  rateLimit: ApiKeyRateLimitDecision;
}

/**
 * Per-process debounce of `last_used_at` writes so a hot key doesn't
 * generate one UPDATE per request.
 */
const LAST_USED_DEBOUNCE_MS = 60_000;
const lastUsedFlush: Map<string, number> = new Map();

async function recordLastUsed(keyId: string, ip: string): Promise<void> {
  const now = Date.now();
  const last = lastUsedFlush.get(keyId) ?? 0;
  if (now - last < LAST_USED_DEBOUNCE_MS) return;
  lastUsedFlush.set(keyId, now);
  // Fire and forget — failure here must not break the request.
  db.update(apiKeys)
    .set({ lastUsedAt: new Date(), lastUsedIp: ip.slice(0, 64) })
    .where(eq(apiKeys.id, keyId))
    .catch((err) => {
      console.error("[api-auth] failed to update last_used_at", err);
    });
}

/**
 * Authenticate a bearer API key (REST or MCP) and confirm every required
 * scope. Throws `ApiError` on any failure — REST handlers translate that
 * into RFC-7807 via `runApiRoute`; MCP maps it into tool errors.
 */
export async function authenticateApiKey(opts: {
  authorizationHeader: string | null;
  ip: string;
  required?: readonly Scope[];
}): Promise<ApiAuthContext> {
  const required = opts.required ?? [];
  const auth = opts.authorizationHeader;
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    throw apiErrors.missingCredentials();
  }
  const token = auth.slice(7).trim();
  if (isDeviceAccessToken(token)) {
    return authenticateDeviceAccess({
      token,
      ip: opts.ip,
      required,
    });
  }
  const parsed = parseApiKey(token);
  if (!parsed) {
    throw apiErrors.invalidKey();
  }

  // Auth-failure brake is checked BEFORE the DB lookup so an attacker can't
  // amplify load by generating misses. Triggered by failed validations
  // *of the same publicId* — a wrong key with a random publicId never piles
  // on someone else's bucket.
  const brake = await enforceAuthFailureBrake(parsed.publicId);
  if (!brake.ok) {
    throw apiErrors.rateLimited(
      brake.retryAfter,
      "Too many failed authentication attempts for this key.",
    );
  }

  const row = await loadKeyByPublicId(parsed.publicId);
  if (!row) {
    throw apiErrors.invalidKey();
  }
  if (row.revokedAt) {
    throw apiErrors.invalidKey();
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw apiErrors.expiredKey();
  }
  if (row.mode !== parsed.mode) {
    // Mode prefix in the token must match the row.
    throw apiErrors.invalidKey();
  }

  const candidate = hashSecret(parsed.secret);
  if (!secretMatches(row.secretHash, candidate)) {
    throw apiErrors.invalidKey();
  }

  const scopes = row.scopes as Scope[];
  for (const need of required) {
    if (!scopes.includes(need)) {
      throw apiErrors.missingScope([...required], scopes);
    }
  }

  const rateLimit = await enforceApiKeyLimits(row.id);
  if (!rateLimit.ok) {
    throw new ApiError({
      code: "rate_limited",
      status: 429,
      title: "Too many requests",
      detail: `${rateLimit.bucket} limit exceeded`,
      headers: {
        "retry-after": String(rateLimit.retryAfter),
        ...rateLimitHeaders(rateLimit),
      },
    });
  }

  const userRow = await loadUser(row.userId);
  if (!userRow) {
    throw apiErrors.invalidKey();
  }

  void recordLastUsed(row.id, opts.ip);

  return {
    user: { id: userRow.id, email: userRow.email, name: userRow.name },
    credential: "api_key",
    apiKey: {
      id: row.id,
      name: row.name,
      mode: row.mode as ApiKeyMode,
      scopes,
      publicId: row.publicId,
    },
    ip: opts.ip,
    rateLimit,
  };
}

/**
 * Authenticate the request and confirm the calling key has every required
 * scope. Throws `ApiError` on any failure — the route handler's wrapper
 * (`runApiRoute`) translates that into an RFC-7807 response.
 */
export async function requireApiKey(
  req: NextRequest,
  required: readonly Scope[],
): Promise<ApiAuthContext> {
  return authenticateApiKey({
    authorizationHeader: req.headers.get("authorization"),
    ip: clientIpFromRequest(req),
    required,
  });
}

async function loadKeyByPublicId(publicId: string): Promise<ApiKeyRow | null> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.publicId, publicId)))
    .limit(1);
  return rows[0] ?? null;
}

async function loadUser(
  userId: string,
): Promise<{ id: string; email: string; name: string | null } | null> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

// Re-exported for use in handlers that want the ip context separately.
export { clientIpFromRequest };
export { sql };
