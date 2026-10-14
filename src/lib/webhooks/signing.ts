import crypto from "node:crypto";

/**
 * Webhook signing + secret storage.
 *
 * Outgoing deliveries carry a Stripe/Slack-style header:
 *
 *   X-Involoops-Signature: t=<unix-seconds>,v1=<hex HMAC>
 *
 * HMAC input = `${t}.${raw_body}` keyed by the endpoint's plaintext
 * secret. Because the server must know the plaintext at send time, we
 * store the secret as AES-256-GCM ciphertext (same pattern as
 * users.anthropic_api_key_*) and decrypt on the delivery path only.
 *
 * The encryption key is derived with HKDF from
 * WEBHOOK_SECRET_ENCRYPTION_SECRET → USER_API_KEY_ENCRYPTION_SECRET →
 * AUTH_SECRET. At least one must be set or webhook creation refuses.
 */

const ALGO = "aes-256-gcm";
const HKDF_INFO = Buffer.from("invoices:webhook-endpoint-secret:v1", "utf8");

function getEncryptionSecret(): string | null {
  const dedicated = process.env.WEBHOOK_SECRET_ENCRYPTION_SECRET?.trim();
  if (dedicated && dedicated.length > 0) return dedicated;
  const shared = process.env.USER_API_KEY_ENCRYPTION_SECRET?.trim();
  if (shared && shared.length > 0) return shared;
  const authSecret = process.env.AUTH_SECRET?.trim();
  if (authSecret && authSecret.length > 0) return authSecret;
  return null;
}

function deriveAesKey(): Buffer {
  const secret = getEncryptionSecret();
  if (!secret) {
    throw new Error(
      "No encryption secret configured. Set WEBHOOK_SECRET_ENCRYPTION_SECRET (preferred) or AUTH_SECRET.",
    );
  }
  const prk = crypto.createHash("sha256").update(secret).digest();
  const keyBytes = crypto.hkdfSync("sha256", prk, Buffer.alloc(0), HKDF_INFO, 32);
  return Buffer.from(keyBytes as ArrayBuffer);
}

export function isWebhookSecretStorageConfigured(): boolean {
  return getEncryptionSecret() !== null;
}

export interface EncryptedSecret {
  ciphertext: string; // hex
  iv: string; // hex
  tag: string; // hex
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = deriveAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
}

export function decryptSecret(enc: EncryptedSecret): string {
  const key = deriveAesKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(enc.iv, "hex"));
  decipher.setAuthTag(Buffer.from(enc.tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Generate a fresh `whsec_<28 hex>.<32 hex>` secret. */
export function generateWebhookSecret(): {
  token: string;
  hint: string;
  encrypted: EncryptedSecret;
} {
  const publicId = crypto.randomBytes(14).toString("hex"); // 28 chars
  const secret = crypto.randomBytes(16).toString("hex"); // 32 chars
  const token = `whsec_${publicId}.${secret}`;
  const encrypted = encryptSecret(token);
  return { token, hint: publicId.slice(0, 8), encrypted };
}

export function signPayload(
  rawBody: string,
  tokenPlaintext: string,
  nowMs: number = Date.now(),
): { header: string; timestamp: number } {
  const t = Math.floor(nowMs / 1000);
  const mac = crypto
    .createHmac("sha256", tokenPlaintext)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  return { header: `t=${t},v1=${mac}`, timestamp: t };
}

export interface VerifyOptions {
  toleranceSec?: number;
}

/**
 * Verify a delivery signature. Useful for tests and for receivers who
 * want to reuse our verifier logic.
 */
export function verifySignature(
  header: string | null,
  rawBody: string,
  tokenPlaintext: string,
  opts: VerifyOptions = {},
): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  const sent = parts.find((p) => p.startsWith("v1="))?.slice(3);
  if (!t || !sent) return false;

  const tolerance = opts.toleranceSec ?? 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > tolerance) return false;

  const expected = crypto
    .createHmac("sha256", tokenPlaintext)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  if (expected.length !== sent.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(sent, "hex"),
    );
  } catch {
    return false;
  }
}
