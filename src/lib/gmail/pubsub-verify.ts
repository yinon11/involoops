/**
 * Verifies the OIDC JWT that Cloud Pub/Sub attaches to every push
 * delivery. Without this check, anyone on the internet who knows the
 * webhook URL could POST forged invoice notifications.
 *
 * How Pub/Sub push auth works:
 *   1. When the push subscription is created with `oidcToken`, every
 *      delivery includes `Authorization: Bearer <jwt>`.
 *   2. The JWT is signed by Google's IAM service-account key for
 *      Pub/Sub itself (`service-<project>@gcp-sa-pubsub.iam.gserviceaccount.com`).
 *   3. We verify the signature against Google's public certs, plus
 *      the standard claims: `iss`, `aud`, `exp`, `iat`.
 *
 * The `aud` claim is what we configured on the push subscription —
 * typically the webhook URL. We pass it via `GMAIL_PUBSUB_AUDIENCE` so
 * that rotating the URL doesn't require code changes.
 *
 * `iss` is always `https://accounts.google.com` for Pub/Sub OIDC tokens.
 */

import { OAuth2Client } from "google-auth-library";

const GOOGLE_ISSUER = "https://accounts.google.com";

/**
 * Module-level OAuth2Client. Its only job here is `verifyIdToken`, which
 * fetches & caches Google's signing certs internally. Reusing one
 * instance keeps the cert cache hot across requests.
 */
let verifier: OAuth2Client | null = null;
function getVerifier(): OAuth2Client {
  if (!verifier) verifier = new OAuth2Client();
  return verifier;
}

export interface VerifiedPushClaims {
  /**
   * Email of the service account whose key signed the JWT — Pub/Sub's
   * own SA. Useful for an extra defence-in-depth check if you want to
   * pin acceptance to a specific project's Pub/Sub.
   */
  email: string;
  /** Issuer; always `https://accounts.google.com` for Pub/Sub OIDC. */
  iss: string;
  /** Audience the token was minted for — must match our expected one. */
  aud: string;
  /** Standard JWT claims that may be useful for logging. */
  iat: number;
  exp: number;
}

/**
 * Verify the bearer token attached to a Pub/Sub push and return the
 * parsed claims. Throws on any failure (bad signature, wrong audience,
 * expired, missing email claim) so the caller can log + 401.
 *
 * Caller usage:
 *
 *   const auth = req.headers.get("authorization");
 *   if (!auth?.startsWith("Bearer ")) return new Response("...", { status: 401 });
 *   try {
 *     await verifyPubSubJwt(auth.slice(7), expectedAudience);
 *   } catch (err) {
 *     return new Response("...", { status: 401 });
 *   }
 */
export async function verifyPubSubJwt(
  jwt: string,
  expectedAudience: string,
): Promise<VerifiedPushClaims> {
  const ticket = await getVerifier().verifyIdToken({
    idToken: jwt,
    audience: expectedAudience,
  });
  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error("Pub/Sub JWT had no payload");
  }
  // Belt-and-braces: verifyIdToken already enforces these, but a
  // mismatch here means library behaviour changed under us, which we'd
  // rather fail loudly on than silently trust.
  if (payload.iss !== GOOGLE_ISSUER && payload.iss !== "accounts.google.com") {
    throw new Error(`Unexpected JWT issuer: ${payload.iss}`);
  }
  if (payload.aud !== expectedAudience) {
    throw new Error(
      `JWT aud mismatch: got ${payload.aud}, expected ${expectedAudience}`,
    );
  }
  if (!payload.email) {
    throw new Error("Pub/Sub JWT missing `email` claim");
  }
  return {
    email: payload.email,
    iss: payload.iss,
    aud: payload.aud,
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  };
}

/**
 * Decode a Pub/Sub push body. Google wraps the actual notification
 * (Gmail's `{emailAddress, historyId}` JSON) inside a base64-encoded
 * `message.data` field. Returns the parsed inner payload or null if
 * the body shape doesn't match.
 */
export interface GmailPushPayload {
  emailAddress: string;
  historyId: string;
}

interface PubSubPushBody {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
}

/**
 * Pub/Sub JSON uses standard base64 for `message.data`, but Gmail's guide
 * documents Base64URL for the inner Gmail notification. Accept both by
 * normalizing `-`/`_` and padding before decoding.
 */
function decodePubSubMessageData(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad ? normalized + "=".repeat(4 - pad) : normalized;
  return Buffer.from(padded, "base64").toString("utf8");
}

function normalizeHistoryId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return null;
}

export function decodeGmailPush(body: unknown): GmailPushPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as PubSubPushBody).message?.data;
  if (typeof data !== "string") return null;
  try {
    const json = decodePubSubMessageData(data);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const emailAddress = parsed.emailAddress;
    const historyId = normalizeHistoryId(parsed.historyId);
    if (typeof emailAddress !== "string" || !historyId) {
      return null;
    }
    return { emailAddress, historyId };
  } catch {
    return null;
  }
}
