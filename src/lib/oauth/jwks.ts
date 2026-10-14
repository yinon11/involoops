import { createHash, createPrivateKey, generateKeyPairSync, type JsonWebKey } from "node:crypto";

/**
 * Signing keys for oidc-provider.
 *
 * Without a `jwks` option oidc-provider falls back to a keyset that ships INSIDE the npm package
 * (lib/consts/dev_keystore.js) — a private key the whole internet holds, hence its startup warning.
 * Access tokens are opaque, so this key signs ID tokens. It must not be that public key: anyone
 * who holds it can forge a token this server will accept the moment a signature is trusted.
 *
 * Generate once (`npm run oauth:gen-jwks`), store as OAUTH_JWKS in the server env, never commit it.
 */

export type PrivateJwk = JsonWebKey & { kid: string; d: string };
export type Jwks = { keys: PrivateJwk[] };

/** kid of the private key shipped inside oidc-provider. That key is public. */
const PUBLISHED_DEV_KID = "keystore-CHANGE-ME";

/** RFC 7638 thumbprint, the conventional stable `kid`. */
function thumbprint(jwk: JsonWebKey): string {
  let members: Record<string, string | undefined>;
  if (jwk.kty === "RSA") members = { e: jwk.e, kty: jwk.kty, n: jwk.n };
  else if (jwk.kty === "EC") members = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  else throw new Error(`unsupported kty ${String(jwk.kty)}`);
  return createHash("sha256").update(JSON.stringify(members)).digest("base64url");
}

/** One RSA-2048 signing key (RS256, oidc-provider's default ID-token algorithm). */
export function generateJwks(): Jwks {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = privateKey.export({ format: "jwk" }) as JsonWebKey;
  const key: PrivateJwk = { ...(jwk as PrivateJwk), kid: thumbprint(jwk), use: "sig", alg: "RS256" };
  return { keys: [key] };
}

/**
 * Validate the OAUTH_JWKS value. Every key must be a PRIVATE RSA or EC key with a kid.
 * The published development key is refused so a placeholder cannot boot.
 */
export function parseJwks(raw: string): Jwks {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OAUTH_JWKS is not valid JSON");
  }
  const keys = (parsed as { keys?: unknown })?.keys;
  if (!Array.isArray(keys) || keys.length === 0) throw new Error("OAUTH_JWKS must be a JWK Set with at least one key");
  for (const key of keys as Record<string, unknown>[]) {
    const kty = key.kty;
    if (kty !== "RSA" && kty !== "EC") throw new Error(`OAUTH_JWKS: unsupported kty ${String(kty)} (use RSA or EC)`);
    if (typeof key.d !== "string" || key.d.length === 0) throw new Error("OAUTH_JWKS: every key must be a PRIVATE key (missing d)");
    if (typeof key.kid !== "string" || key.kid.length === 0) throw new Error("OAUTH_JWKS: every key needs a kid");
    if (key.kid === PUBLISHED_DEV_KID) {
      throw new Error("OAUTH_JWKS: refusing oidc-provider's published development key (kid keystore-CHANGE-ME)");
    }
    if (key.use !== undefined && key.use !== "sig") throw new Error(`OAUTH_JWKS: key ${String(key.kid)} has use=${String(key.use)}, expected sig`);
    try {
      createPrivateKey({ key: key as JsonWebKey, format: "jwk" });
    } catch (err) {
      throw new Error(`OAUTH_JWKS: key ${String(key.kid)} is not a usable private key (${(err as Error).message})`);
    }
  }
  return parsed as Jwks;
}

/** The configured keyset, or null when OAUTH_JWKS is unset. Throws on a malformed value. */
export function oauthJwks(): Jwks | null {
  const raw = (process.env.OAUTH_JWKS ?? "").trim();
  if (!raw) return null;
  return parseJwks(raw);
}

/** Same switch as oauthConfigured(), without importing the rest of the app. */
function oauthIsOn(): boolean {
  const secret = process.env.ANTHROPIC_MCP_CLIENT_SECRET?.trim() ?? "";
  const issuer = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || "").trim();
  return Boolean(
    issuer &&
      process.env.AUTH_SECRET &&
      process.env.ANTHROPIC_MCP_CLIENT_ID?.trim() &&
      secret.length >= 32,
  );
}

/**
 * When OAuth is on, a missing or development keyset must stop the process.
 * Returns null when OAuth is off or the keyset is a real private key.
 */
export function oauthJwksBootError(): string | null {
  if (!oauthIsOn()) return null;
  try {
    if (!oauthJwks()) return "Refusing to boot: OAUTH_JWKS is not set.";
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Refusing to boot: ${message}`;
  }
}

/** Exit the process when OAuth is configured without a real signing key. */
export function assertOauthJwksBoot(): void {
  const message = oauthJwksBootError();
  if (!message) return;
  console.error(`[oauth] ${message}`);
  process.exit(1);
}
