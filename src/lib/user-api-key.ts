/**
 * Per-user Anthropic API key: encryption, validation, and resolution.
 *
 * Security model
 * ---------------
 * 1. The key is stored as AES-256-GCM ciphertext (ciphertext + iv + tag).
 *    No plaintext key ever touches the database or the logs.
 * 2. The encryption key is derived with HKDF from
 *    process.env.USER_API_KEY_ENCRYPTION_SECRET (preferred) or AUTH_SECRET
 *    (fallback, already required for sessions). If neither is set we refuse
 *    to encrypt/decrypt — the feature is disabled rather than insecure.
 * 3. A save-time probe (a tiny `count_tokens` request to Anthropic) proves
 *    the key actually works before we accept it. Only then do we set
 *    validated_at.
 * 4. Tier resolution (`@/lib/usage`, `@/lib/effective-tier`) treats a user
 *    as BYOK — and therefore Enterprise-equivalent — only when ciphertext,
 *    iv, tag AND validated_at are all non-null. Removing the key instantly
 *    reverts the user to their paid/free subscription tier.
 */

import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getExtractionModel,
  isAnthropicModelNotFound,
} from "@/lib/extraction/anthropic-models";

const ALGO = "aes-256-gcm";
/** Distinguishes derived keys from other HKDF uses of AUTH_SECRET. */
const HKDF_INFO = Buffer.from("invoices:user-anthropic-api-key:v1", "utf8");

function getEncryptionSecret(): string | null {
  const dedicated = process.env.USER_API_KEY_ENCRYPTION_SECRET?.trim();
  if (dedicated && dedicated.length > 0) return dedicated;
  const authSecret = process.env.AUTH_SECRET?.trim();
  if (authSecret && authSecret.length > 0) return authSecret;
  return null;
}

function deriveAesKey(): Buffer {
  const secret = getEncryptionSecret();
  if (!secret) {
    throw new Error(
      "USER_API_KEY_ENCRYPTION_SECRET (or AUTH_SECRET) must be set to store user-provided Anthropic keys."
    );
  }
  // Deterministic per-process; no per-record salt because we already
  // generate a fresh IV for every encryption. HKDF with a constant salt is
  // a standard pattern for deriving a symmetric key from a high-entropy
  // secret.
  const prk = crypto.createHash("sha256").update(secret).digest();
  const keyBytes = crypto.hkdfSync("sha256", prk, Buffer.alloc(0), HKDF_INFO, 32);
  // hkdfSync returns ArrayBuffer in Node; normalize to Buffer.
  return Buffer.from(keyBytes as ArrayBuffer);
}

/** Return whether key storage is configured (has encryption secret). */
export function isUserApiKeyStorageConfigured(): boolean {
  return getEncryptionSecret() !== null;
}

export interface EncryptedKey {
  ciphertext: string; // hex
  iv: string; // hex
  tag: string; // hex
}

function encryptKey(plaintext: string): EncryptedKey {
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

function decryptKey(enc: EncryptedKey): string {
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

/**
 * Basic shape check — Anthropic keys start with `sk-ant-` and are long. We
 * only reject obviously-wrong input here; real validation happens via the
 * live probe below. Don't log the input.
 */
function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(key);
}

/**
 * Stable error codes from the BYOK key validation flow. The server returns
 * one of these so the client can render a translated message and decide
 * whether to offer recovery CTAs (e.g. "Continue with platform key").
 */
export type SaveKeyErrorCode =
  | "invalid_format"
  | "storage_unconfigured"
  | "model_access"
  | "unauthorized"
  | "rate_limited"
  | "network";

export interface ProbeError {
  code: "model_access" | "unauthorized" | "rate_limited" | "network";
  /** English fallback message — clients prefer the translated dict copy keyed by `code`. */
  message: string;
  /** Set when `code === "model_access"`: the model the user's key can't reach. */
  model?: string;
}

/**
 * Probe the key against Anthropic with a tiny `count_tokens` request. This
 * costs nothing (no tokens billed) but returns 401 for a bad key, so it's
 * the safest way to confirm a key is valid without spending the user's
 * credits. Falls back to a minimal `messages.create` if `count_tokens` is
 * unavailable in the SDK version.
 *
 * IMPORTANT: We probe with the *actual extraction model* (Sonnet 4 by
 * default), not Haiku. Anthropic returns 401 for an invalid key but
 * 404 (`not_found_error`) for a valid key whose tier doesn't include
 * the requested model. Probing Haiku used to mark keys validated even
 * when the user couldn't actually run extraction — so the next upload
 * silently produced an empty pending invoice with no explanation.
 */
async function probeAnthropicKey(
  apiKey: string
): Promise<{ ok: true } | { ok: false; error: ProbeError }> {
  const model = getExtractionModel();
  try {
    const client = new Anthropic({ apiKey });
    type CountTokensClient = {
      messages?: {
        countTokens?: (args: unknown) => Promise<unknown>;
      };
    };
    const maybeCount = (client as unknown as CountTokensClient).messages
      ?.countTokens;
    if (typeof maybeCount === "function") {
      await maybeCount.call(client.messages, {
        model,
        messages: [{ role: "user", content: "ping" }],
      });
      return { ok: true };
    }
    // SDK without countTokens — do the cheapest possible call: 1-token
    // response. The user pays pennies at most.
    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true };
  } catch (err: unknown) {
    const status = extractStatus(err);
    if (status === 401 || status === 403) {
      return {
        ok: false,
        error: {
          code: "unauthorized",
          message:
            "Anthropic rejected this key. Double-check the value you pasted.",
        },
      };
    }
    if (isAnthropicModelNotFound(err)) {
      return {
        ok: false,
        error: {
          code: "model_access",
          model,
          message:
            `This Anthropic key works, but your account doesn't have access to the model we use for invoice extraction (${model}). ` +
            `We didn't save the key — you're still using our platform key, so the app keeps working. ` +
            `To use your own key, upgrade your Anthropic account to Build tier (add a payment method at console.anthropic.com → Plans), then come back and paste the key again.`,
        },
      };
    }
    if (status === 429) {
      return {
        ok: false,
        error: {
          code: "rate_limited",
          message:
            "Anthropic rate-limited the validation call. Try again in a moment.",
        },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        code: "network",
        message: `Could not reach Anthropic to validate the key: ${message}`,
      },
    };
  }
}

function extractStatus(err: unknown): number | null {
  if (err && typeof err === "object") {
    const maybe = err as { status?: unknown; statusCode?: unknown };
    if (typeof maybe.status === "number") return maybe.status;
    if (typeof maybe.statusCode === "number") return maybe.statusCode;
  }
  return null;
}

export interface ApiKeyStatus {
  hasKey: boolean;
  hint: string | null;
  validatedAt: Date | null;
}

export async function getUserApiKeyStatus(
  userId: string
): Promise<ApiKeyStatus> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      anthropicApiKeyCiphertext: true,
      anthropicApiKeyHint: true,
      anthropicApiKeyValidatedAt: true,
    },
  });
  if (!row?.anthropicApiKeyCiphertext) {
    return { hasKey: false, hint: null, validatedAt: null };
  }
  return {
    hasKey: true,
    hint: row.anthropicApiKeyHint ?? null,
    validatedAt: row.anthropicApiKeyValidatedAt ?? null,
  };
}

/**
 * Server-only: return true when the user has a stored, validated key.
 * This is the single source of truth for "is the user BYOK?"; tier
 * resolution calls it on every quota check.
 */
export async function isUserByok(userId: string): Promise<boolean> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      anthropicApiKeyCiphertext: true,
      anthropicApiKeyIv: true,
      anthropicApiKeyTag: true,
      anthropicApiKeyValidatedAt: true,
    },
  });
  if (!row) return false;
  return (
    !!row.anthropicApiKeyCiphertext &&
    !!row.anthropicApiKeyIv &&
    !!row.anthropicApiKeyTag &&
    !!row.anthropicApiKeyValidatedAt
  );
}

/**
 * Server-only: get the plaintext Anthropic API key for this user, or null
 * if they don't have one (or decryption failed). The caller MUST NOT log
 * the return value.
 */
export async function getDecryptedUserApiKey(
  userId: string
): Promise<string | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      anthropicApiKeyCiphertext: true,
      anthropicApiKeyIv: true,
      anthropicApiKeyTag: true,
      anthropicApiKeyValidatedAt: true,
    },
  });
  if (
    !row?.anthropicApiKeyCiphertext ||
    !row.anthropicApiKeyIv ||
    !row.anthropicApiKeyTag ||
    !row.anthropicApiKeyValidatedAt
  ) {
    return null;
  }
  try {
    return decryptKey({
      ciphertext: row.anthropicApiKeyCiphertext,
      iv: row.anthropicApiKeyIv,
      tag: row.anthropicApiKeyTag,
    });
  } catch (err) {
    // Auth-tag mismatch → data-at-rest tampered with, or encryption secret
    // rotated without re-encryption. Either way, don't hand back anything.
    console.error(
      "[user-api-key] Decryption failed for user %s: %s",
      userId,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * Resolve the Anthropic key we should use for a given user. User-provided
 * (BYOK) wins; otherwise fall back to the shared platform key. Returns
 * null when neither is available (caller decides whether to skip LLM or
 * fail).
 */
export async function resolveAnthropicApiKey(userId: string): Promise<{
  key: string | null;
  source: "user" | "platform" | "none";
}> {
  const userKey = await getDecryptedUserApiKey(userId);
  if (userKey) return { key: userKey, source: "user" };
  const platformKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
  if (platformKey) return { key: platformKey, source: "platform" };
  return { key: null, source: "none" };
}

export type SaveKeyResult =
  | { ok: true; hint: string }
  | {
      ok: false;
      /** English fallback message for logs/server-side use; clients prefer the dict copy keyed by `code`. */
      error: string;
      code: SaveKeyErrorCode;
      /** Set when `code === "model_access"`. */
      model?: string;
    };

/**
 * Validate and persist a user's Anthropic key.
 *
 * Security notes:
 *   - The input is trimmed but never logged.
 *   - We only persist ciphertext + iv + tag + a 4-char hint.
 *   - `validated_at` is set only after a live probe succeeds, so tier
 *     resolution can't be tricked into granting BYOK access with a rejected
 *     key.
 */
export async function saveUserApiKey(
  userId: string,
  rawKey: string
): Promise<SaveKeyResult> {
  if (!isUserApiKeyStorageConfigured()) {
    return {
      ok: false,
      code: "storage_unconfigured",
      error:
        "Server is not configured to store API keys (missing AUTH_SECRET / USER_API_KEY_ENCRYPTION_SECRET).",
    };
  }

  const key = rawKey.trim();
  if (!looksLikeAnthropicKey(key)) {
    return {
      ok: false,
      code: "invalid_format",
      error:
        "That doesn't look like an Anthropic API key. Keys start with 'sk-ant-'.",
    };
  }

  const probe = await probeAnthropicKey(key);
  if (!probe.ok) {
    return {
      ok: false,
      code: probe.error.code,
      error: probe.error.message,
      ...(probe.error.model ? { model: probe.error.model } : {}),
    };
  }

  const encrypted = encryptKey(key);
  const hint = `...${key.slice(-4)}`;

  await db
    .update(users)
    .set({
      anthropicApiKeyCiphertext: encrypted.ciphertext,
      anthropicApiKeyIv: encrypted.iv,
      anthropicApiKeyTag: encrypted.tag,
      anthropicApiKeyHint: hint,
      anthropicApiKeyValidatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return { ok: true, hint };
}

/**
 * Remove the user's Anthropic key. Tier resolution reverts immediately to
 * their paid/free subscription on the next request — we never keep a
 * "grace period" for BYOK after the key is gone, to prevent a
 * remove-and-keep-enterprise exploit.
 */
export async function removeUserApiKey(userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      anthropicApiKeyCiphertext: null,
      anthropicApiKeyIv: null,
      anthropicApiKeyTag: null,
      anthropicApiKeyHint: null,
      anthropicApiKeyValidatedAt: null,
    })
    .where(eq(users.id, userId));
}
