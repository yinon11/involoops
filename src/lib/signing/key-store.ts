import { readFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

/**
 * Signing key access for the server. The private key is loaded once per
 * process and cached as a Node `KeyObject`.
 *
 * Production reads `SIGNING_PRIVATE_KEY_FILE` (a PEM file mounted
 * read-only, same pattern as the PDF keystore). Dev may still use
 * `SIGNING_PRIVATE_KEY_PEM`. When the file is set, the env PEM is ignored.
 * `\n` escape sequences are accepted in either form.
 *
 * NEVER log the decoded private key. The only places that touch it are
 * `signDocument` (to produce a signature) and nothing else.
 */

let cachedPrivateKey: KeyObject | undefined;
let cachedKeyId: string | undefined;

function normalisePem(raw: string): string {
  // Env-var transports often lose literal newlines; accept `\n` escapes.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function getSigningKeyId(): string {
  if (cachedKeyId) return cachedKeyId;
  const keyId = process.env.SIGNING_KEY_ID;
  if (!keyId || !keyId.trim()) {
    throw new Error(
      "SIGNING_KEY_ID is not set. Run `npx tsx scripts/generate-dev-signing-key.ts --env dev` and paste the output into `.env`.",
    );
  }
  cachedKeyId = keyId.trim();
  return cachedKeyId;
}

function loadPrivateKeyPem(): string {
  const file = process.env.SIGNING_PRIVATE_KEY_FILE?.trim();
  if (file) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read SIGNING_PRIVATE_KEY_FILE at ${file}: ${message}`);
    }
    if (!raw.trim()) {
      throw new Error(`SIGNING_PRIVATE_KEY_FILE at ${file} is empty.`);
    }
    return raw;
  }
  const raw = process.env.SIGNING_PRIVATE_KEY_PEM;
  if (!raw) {
    throw new Error(
      "No signing private key. Set SIGNING_PRIVATE_KEY_FILE (production) or SIGNING_PRIVATE_KEY_PEM (dev). Run `npx tsx scripts/generate-dev-signing-key.ts --env dev` to bootstrap a dev key.",
    );
  }
  return raw;
}

export function getSigningPrivateKey(): KeyObject {
  if (cachedPrivateKey) return cachedPrivateKey;
  cachedPrivateKey = createPrivateKey({
    key: normalisePem(loadPrivateKeyPem()),
    format: "pem",
  });
  return cachedPrivateKey;
}

/**
 * Load a public key from its PEM string (as stored in `signing_keys`).
 * Not cached because callers verify with the key that matches the
 * signature's `keyId`, which may be any past key during retirement.
 *
 * Two robustness measures, both learned from a production incident where
 * `/verify` 500'd on `ERR_OSSL_UNSUPPORTED`:
 *   1. Unwind `\n` escape sequences the same way {@link getSigningPrivateKey}
 *      does — a PEM stored straight from an env var keeps literal `\n`, which
 *      the OpenSSL 3 decoder rejects outright.
 *   2. If the column actually holds a PRIVATE key (a known data defect on at
 *      least one row), derive the public key from it — `createPublicKey`
 *      accepts a private key and extracts the matching public part — instead
 *      of throwing and taking down the public verification page.
 */
export function loadPublicKey(pem: string): KeyObject {
  return createPublicKey({ key: normalisePem(pem), format: "pem" });
}

/** Signing algorithm for the dev key; `RS256` = RSASSA-PKCS1-v1_5 + SHA-256. */
export const DEFAULT_SIGNING_ALGORITHM = "RS256" as const;
export const DEFAULT_HASH_ALGORITHM = "sha256" as const;
