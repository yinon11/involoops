import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM encryption for SHAAM refresh/access tokens (Spec 07).
 *
 * Key derivation:
 *   - First preference: SHA-256(`SHAAM_TOKEN_ENCRYPTION_SECRET`).
 *   - Fallback: SHA-256(`"shaam-tokens:" + AUTH_SECRET`) — the salt
 *     prefix namespaces the key so it never collides with other
 *     AUTH_SECRET-derived keys (BYOK, MFA, etc).
 *
 * Throws at decryption if the GCM auth tag mismatches — that is the
 * tamper-detection guarantee.
 */

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;
const KEY_SALT_PREFIX = "shaam-tokens:";

let cachedKey: Buffer | undefined;

function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const primary = process.env.SHAAM_TOKEN_ENCRYPTION_SECRET;
  if (primary && primary.trim().length > 0) {
    cachedKey = createHash("sha256").update(primary, "utf8").digest();
    return cachedKey;
  }
  const fallback = process.env.AUTH_SECRET;
  if (!fallback || fallback.trim().length === 0) {
    throw new Error(
      "SHAAM token encryption requires SHAAM_TOKEN_ENCRYPTION_SECRET (preferred) or AUTH_SECRET. Neither is set.",
    );
  }
  cachedKey = createHash("sha256")
    .update(KEY_SALT_PREFIX + fallback, "utf8")
    .digest();
  return cachedKey;
}

export interface EncryptedToken {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptToken(plaintext: string): EncryptedToken {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptToken: plaintext must be a non-empty string");
  }
  const key = deriveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptToken(params: EncryptedToken): string {
  const key = deriveKey();
  const iv = Buffer.from(params.iv, "base64");
  const tag = Buffer.from(params.tag, "base64");
  const ct = Buffer.from(params.ciphertext, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * One-shot self-test. Called at module load in dev / on admin page
 * render so config errors surface early instead of at the first real
 * authorization attempt.
 */
export function runTokenCryptoSelfTest(): { ok: true } | { ok: false; error: string } {
  try {
    const sample = "selftest-" + Date.now().toString(16);
    const enc = encryptToken(sample);
    const dec = decryptToken(enc);
    if (dec !== sample) {
      return { ok: false, error: "roundtrip mismatch" };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Exposed for scripts/verify-shaam-oauth.ts tamper tests. Tests flip
 * a byte in the ciphertext and expect `decryptToken` to throw.
 */
export function _resetKeyCacheForTests(): void {
  cachedKey = undefined;
}
