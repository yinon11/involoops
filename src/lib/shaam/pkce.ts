import { createHash, randomBytes } from "node:crypto";

/**
 * RFC 7636 PKCE helpers.
 *
 * - `code_verifier` is 43–128 chars of `[A-Z a-z 0-9 - . _ ~]` — we
 *   use 64 URL-safe base64 chars which sits comfortably inside that.
 * - `code_challenge` is BASE64URL(SHA-256(verifier)).
 * - `state` is a 32-byte random URL-safe nonce; we use it both as the
 *   OAuth `state` parameter and the PK of the pending-state row so
 *   callback lookups are O(1) and forgery requires guessing it.
 */

function urlSafeBase64(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function generateCodeVerifier(): string {
  return urlSafeBase64(randomBytes(48));
}

export function codeChallengeFrom(verifier: string): string {
  return urlSafeBase64(createHash("sha256").update(verifier, "utf8").digest());
}

export function generateState(): string {
  return urlSafeBase64(randomBytes(32));
}
