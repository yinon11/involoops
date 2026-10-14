import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { deviceSessions, users } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ApiError, apiErrors } from "./errors";
import { enforceApiKeyLimits, type ApiKeyRateLimitDecision } from "./rate-limit";
import { SCOPES, type Scope } from "./scopes";
import type { ApiAuthContext } from "./authenticate";

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REFRESH_PREFIX = "inv_refresh_";

export interface IssuedDeviceTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
  userId: string;
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new ApiError({
      code: "internal_error",
      status: 500,
      title: "Server is missing AUTH_SECRET",
    });
  }
  return secret;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function signAccess(body: string): string {
  return createHmac("sha256", authSecret())
    .update(`device-access-v1\n${body}`)
    .digest("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHmac("sha256", authSecret())
    .update(`device-refresh-v1\n${token}`)
    .digest("hex");
}

function mintAccessToken(userId: string, sessionId: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      sid: sessionId,
      typ: "device",
      iat: now,
      exp: now + ACCESS_TTL_SECONDS,
    }),
  );
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${signAccess(signingInput)}`;
}

export function readDeviceAccessToken(token: string): {
  userId: string;
  sessionId: string;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  if (!header || !payload || !sig) return null;
  const signingInput = `${header}.${payload}`;
  let expected: string;
  try {
    expected = signAccess(signingInput);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let body: { sub?: unknown; sid?: unknown; typ?: unknown; exp?: unknown };
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (body.typ !== "device") return null;
  if (typeof body.sub !== "string" || typeof body.sid !== "string") return null;
  if (typeof body.exp !== "number" || body.exp * 1000 <= Date.now()) return null;
  return { userId: body.sub, sessionId: body.sid };
}

function newRefreshToken(): string {
  return REFRESH_PREFIX + randomBytes(32).toString("base64url");
}

export function isDeviceAccessToken(token: string): boolean {
  return token.split(".").length === 3 && !token.startsWith("inv_");
}

const LAST_USED_DEBOUNCE_MS = 60_000;
const lastUsedFlush = new Map<string, number>();

async function touchSession(sessionId: string, ip: string): Promise<void> {
  const now = Date.now();
  const last = lastUsedFlush.get(sessionId) ?? 0;
  if (now - last < LAST_USED_DEBOUNCE_MS) return;
  lastUsedFlush.set(sessionId, now);
  db.update(deviceSessions)
    .set({ lastUsedAt: new Date(), lastUsedIp: ip.slice(0, 64) })
    .where(eq(deviceSessions.id, sessionId))
    .catch((err) => {
      console.error("[device-auth] failed to update last_used_at", err);
    });
}

export async function authenticateDeviceAccess(opts: {
  token: string;
  ip: string;
  required: readonly Scope[];
}): Promise<ApiAuthContext> {
  const parsed = readDeviceAccessToken(opts.token);
  if (!parsed) throw apiErrors.invalidKey();

  const [session] = await db
    .select()
    .from(deviceSessions)
    .where(eq(deviceSessions.id, parsed.sessionId))
    .limit(1);
  if (
    !session ||
    session.userId !== parsed.userId ||
    session.revokedAt ||
    session.expiresAt.getTime() <= Date.now()
  ) {
    throw apiErrors.invalidKey();
  }

  const scopes: Scope[] = [...SCOPES];
  for (const need of opts.required) {
    if (!scopes.includes(need)) {
      throw apiErrors.missingScope([...opts.required], scopes);
    }
  }

  const rateLimit = await enforceApiKeyLimits(session.id);
  if (!rateLimit.ok) {
    throw rateLimited(rateLimit);
  }

  const [userRow] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!userRow) throw apiErrors.invalidKey();

  void touchSession(session.id, opts.ip);

  return {
    user: { id: userRow.id, email: userRow.email, name: userRow.name },
    credential: "device",
    apiKey: {
      id: session.id,
      name: session.deviceName,
      mode: "live",
      scopes,
      publicId: `device_${session.id}`,
    },
    ip: opts.ip,
    rateLimit,
  };
}

function rateLimited(rateLimit: ApiKeyRateLimitDecision): ApiError {
  return new ApiError({
    code: "rate_limited",
    status: 429,
    title: "Too many requests",
    detail: `${rateLimit.bucket} limit exceeded`,
    headers: { "retry-after": String(rateLimit.retryAfter) },
  });
}

export async function issueDeviceSession(input: {
  userId: string;
  deviceName: string;
  ip: string;
}): Promise<IssuedDeviceTokens> {
  const refreshToken = newRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const [row] = await db
    .insert(deviceSessions)
    .values({
      userId: input.userId,
      deviceName: input.deviceName.slice(0, 120),
      refreshTokenHash: hashRefreshToken(refreshToken),
      createdByIp: input.ip.slice(0, 64),
      expiresAt,
    })
    .returning({ id: deviceSessions.id });
  if (!row) {
    throw new ApiError({
      code: "internal_error",
      status: 500,
      title: "Could not start a device session",
    });
  }
  return {
    accessToken: mintAccessToken(input.userId, row.id),
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
    sessionId: row.id,
    userId: input.userId,
  };
}

export async function rotateDeviceSession(input: {
  refreshToken: string;
  ip: string;
}): Promise<IssuedDeviceTokens> {
  if (!input.refreshToken.startsWith(REFRESH_PREFIX)) {
    throw apiErrors.invalidKey();
  }
  const hash = hashRefreshToken(input.refreshToken);
  const [session] = await db
    .select()
    .from(deviceSessions)
    .where(
      and(eq(deviceSessions.refreshTokenHash, hash), isNull(deviceSessions.revokedAt)),
    )
    .limit(1);
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw apiErrors.invalidKey();
  }

  const refreshToken = newRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await db
    .update(deviceSessions)
    .set({
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      lastUsedAt: new Date(),
      lastUsedIp: input.ip.slice(0, 64),
    })
    .where(eq(deviceSessions.id, session.id));

  return {
    accessToken: mintAccessToken(session.userId, session.id),
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
    sessionId: session.id,
    userId: session.userId,
  };
}

export async function revokeDeviceSessionByRefreshToken(
  refreshToken: string,
): Promise<void> {
  if (!refreshToken.startsWith(REFRESH_PREFIX)) return;
  await db
    .update(deviceSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(deviceSessions.refreshTokenHash, hashRefreshToken(refreshToken)),
        isNull(deviceSessions.revokedAt),
      ),
    );
}

export async function findUserByEmail(email: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      preferredLocale: users.preferredLocale,
      mfaEnabled: users.mfaEnabled,
      mfaSecretCiphertext: users.mfaSecretCiphertext,
      mfaSecretIv: users.mfaSecretIv,
      mfaSecretTag: users.mfaSecretTag,
      mfaBackupCodes: users.mfaBackupCodes,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  return row ?? null;
}
