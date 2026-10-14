/**
 * TOTP-based multi-factor authentication.
 *
 * Security model
 * ---------------
 * 1. The TOTP shared secret is stored as AES-256-GCM ciphertext (ciphertext +
 *    iv + tag). Plaintext never touches the database or the logs.
 * 2. The AES key is derived with HKDF from process.env.AUTH_SECRET using a
 *    distinct `info` label so it cannot be confused with any other derived
 *    key (same pattern as `@/lib/user-api-key`).
 * 3. Backup codes are random 10-character strings shown to the user exactly
 *    once at generation time. We persist bcrypt hashes and consume a code by
 *    removing its hash from the array — single-use by construction.
 * 4. Enrollment writes `mfa_secret_*` during setup, but `mfa_enabled` flips
 *    to true ONLY after `verifySetupCode` succeeds. A lost/misconfigured
 *    authenticator during setup leaves MFA disabled, never half-enabled.
 */

import crypto from "node:crypto";
import {
  generateSecret as otpGenerateSecret,
  generateURI as otpGenerateURI,
  verifySync as otpVerifySync,
} from "otplib";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";

const ALGO = "aes-256-gcm";
const HKDF_INFO = Buffer.from("invoices:user-mfa-totp-secret:v1", "utf8");

// Accept ±30s drift on each side (one full step) to tolerate clock skew on
// the user's device without widening the attack window unnecessarily.
const TOTP_EPOCH_TOLERANCE_SEC = 30;

function getEncryptionSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

function deriveAesKey(): Buffer {
  const secret = getEncryptionSecret();
  if (!secret) {
    throw new Error(
      "AUTH_SECRET must be set to store MFA secrets."
    );
  }
  const prk = crypto.createHash("sha256").update(secret).digest();
  const keyBytes = crypto.hkdfSync("sha256", prk, Buffer.alloc(0), HKDF_INFO, 32);
  return Buffer.from(keyBytes as ArrayBuffer);
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
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
  const decipher = crypto.createDecipheriv(
    ALGO,
    key,
    Buffer.from(enc.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(enc.tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Generate a fresh base32 TOTP secret suitable for `otpauth://` URIs. */
export function generateTotpSecret(): string {
  return otpGenerateSecret();
}

/**
 * Build the standard `otpauth://totp/...` URI that authenticator apps read
 * from the QR code. The label combines issuer and user for display in the
 * authenticator app's account list.
 */
export function buildOtpAuthUrl(params: {
  accountName: string;
  secret: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? "InvoLoops";
  return otpGenerateURI({
    issuer,
    label: params.accountName,
    secret: params.secret,
  });
}

/** Render the `otpauth://` URI as a data-URI PNG to display inline. */
export async function renderQrDataUri(otpAuthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
  });
}

/**
 * Verify a 6-digit TOTP code against a plaintext secret. Returns true when
 * the code falls inside the configured time window.
 */
export function verifyTotpCode(params: {
  code: string;
  secret: string;
}): boolean {
  const cleaned = params.code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    const result = otpVerifySync({
      token: cleaned,
      secret: params.secret,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SEC,
    });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Generate 10 single-use backup codes. Plaintext codes are returned to the
 * caller (shown to the user exactly once) and the bcrypt hashes are returned
 * separately for persistence. Each code is ~10 chars of crockford-base32 for
 * easy transcription from paper.
 */
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/1/I/L/O
const BACKUP_CODE_LENGTH = 10;
const BACKUP_CODE_COUNT = 10;

export async function generateBackupCodes(): Promise<{
  plaintext: string[];
  hashes: string[];
}> {
  const plaintext: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const bytes = crypto.randomBytes(BACKUP_CODE_LENGTH);
    let code = "";
    for (const b of bytes) {
      code += BACKUP_CODE_ALPHABET[b % BACKUP_CODE_ALPHABET.length];
    }
    // Insert a hyphen at the midpoint for readability: XXXXX-XXXXX.
    const mid = Math.floor(BACKUP_CODE_LENGTH / 2);
    plaintext.push(`${code.slice(0, mid)}-${code.slice(mid)}`);
  }
  const hashes = await Promise.all(
    plaintext.map((code) => bcrypt.hash(normalizeBackupCode(code), 10))
  );
  return { plaintext, hashes };
}

/** Strip whitespace and hyphens; uppercase — so "abc-12de" matches "ABC12DE". */
export function normalizeBackupCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Verify a backup code against the stored hashes. On success, returns the
 * pruned array of remaining hashes (caller persists it). On failure, returns
 * null so the caller can't accidentally save a stale array.
 */
export async function consumeBackupCode(params: {
  input: string;
  storedHashes: string[];
}): Promise<string[] | null> {
  const normalized = normalizeBackupCode(params.input);
  if (!/^[A-Z0-9]+$/.test(normalized)) return null;
  for (let i = 0; i < params.storedHashes.length; i++) {
    const hash = params.storedHashes[i];
    const ok = await bcrypt.compare(normalized, hash);
    if (ok) {
      const remaining = [...params.storedHashes];
      remaining.splice(i, 1);
      return remaining;
    }
  }
  return null;
}
