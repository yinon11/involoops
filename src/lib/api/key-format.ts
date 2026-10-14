import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Helpers for generating and verifying public-API bearer keys.
 * See docs/api/01-auth-and-api-keys.md.
 *
 * Token shape:
 *   inv_(live|test)_<28 chars base62>.<32 chars base62>
 *                    \-- public id --/  \-- secret --/
 *
 * Storage: only the public id is stored unhashed (used to look up the row).
 * The secret is stored as `HMAC-SHA-256(secret, API_KEY_PEPPER)` in hex.
 */

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PUBLIC_ID_LEN = 28;
const SECRET_LEN = 32;

export type ApiKeyMode = "live" | "test";

export interface GeneratedKey {
  /** Full token (only ever exists in memory; show to user once). */
  token: string;
  /** 28-char public segment, indexed in the DB. */
  publicId: string;
  /** 32-char secret segment — HMAC this before storing. */
  secret: string;
  /** Convenience: HMAC of the secret using the configured pepper. */
  secretHash: string;
  /** First 8 chars of the publicId — useful as a UI hint after rotation. */
  hint: string;
  mode: ApiKeyMode;
}

function randomBase62(len: number): string {
  // Use rejection-free mapping by drawing from a 256-byte buffer and folding
  // mod 62. Bias is < 0.4% per char which is fine for an id, not a key — and
  // we only call this for both halves of the token (≥190 bits real entropy).
  const buf = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[buf[i] % 62];
  }
  return out;
}

export function getPepper(): Buffer {
  const raw = process.env.API_KEY_PEPPER;
  if (!raw || raw.length < 32) {
    throw new Error(
      "API_KEY_PEPPER is not set. Generate with `openssl rand -hex 32` and add it to .env.",
    );
  }
  // Accept hex, base64, or raw — easier to bootstrap.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    return Buffer.from(raw, "hex");
  }
  return Buffer.from(raw);
}

export function hashSecret(secret: string): string {
  return createHmac("sha256", getPepper()).update(secret).digest("hex");
}

export function generateApiKey(mode: ApiKeyMode): GeneratedKey {
  const publicId = randomBase62(PUBLIC_ID_LEN);
  const secret = randomBase62(SECRET_LEN);
  const token = `inv_${mode}_${publicId}.${secret}`;
  const secretHash = hashSecret(secret);
  return {
    token,
    publicId,
    secret,
    secretHash,
    hint: publicId.slice(0, 8),
    mode,
  };
}

export interface ParsedKey {
  mode: ApiKeyMode;
  publicId: string;
  secret: string;
}

/** Returns null if the token is malformed; never throws. */
export function parseApiKey(token: string | null | undefined): ParsedKey | null {
  if (!token) return null;
  const m = /^inv_(live|test)_([A-Za-z0-9]{28})\.([A-Za-z0-9]{32})$/.exec(
    token.trim(),
  );
  if (!m) return null;
  return { mode: m[1] as ApiKeyMode, publicId: m[2], secret: m[3] };
}

/** Constant-time hex comparison. Both sides must be even-length hex. */
export function secretMatches(stored: string, candidateHash: string): boolean {
  if (stored.length !== candidateHash.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(stored, "hex"),
      Buffer.from(candidateHash, "hex"),
    );
  } catch {
    return false;
  }
}
