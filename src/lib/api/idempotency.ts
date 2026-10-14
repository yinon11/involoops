import { createHash } from "node:crypto";
import { db } from "@/db";
import { apiIdempotencyKeys } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ApiError, apiErrors } from "./errors";

/**
 * Idempotency-Key replay store. See docs/api/02-conventions.md.
 *
 * Window: 24h (eviction is a separate cron — to be added in Phase 0.1).
 *
 * Required on state-creating POSTs (the route handler decides). On replay
 * with a matching body fingerprint we return the original status + body.
 * On reuse with a different body we return 409 to surface the bug.
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;
const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1_000;

export function readIdempotencyKey(
  req: Request,
  required: boolean,
): string | null {
  const raw = req.headers.get("idempotency-key");
  if (!raw) {
    if (required) {
      throw new ApiError({
        code: "bad_request",
        status: 400,
        title: "Idempotency-Key header is required for this endpoint",
      });
    }
    return null;
  }
  if (!KEY_PATTERN.test(raw)) {
    throw new ApiError({
      code: "bad_request",
      status: 400,
      title: "Idempotency-Key must match [A-Za-z0-9_-]{8,255}",
    });
  }
  return raw;
}

export function fingerprintRequest(
  method: string,
  path: string,
  body: unknown,
): string {
  const canonical = canonicalJson(body);
  return createHash("sha256")
    .update(`${method.toUpperCase()} ${path} ${canonical}`)
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalJson((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

export interface IdempotencyHit {
  status: number;
  body: unknown;
}

/**
 * Look up a prior response for (apiKeyId, key). Returns the stored result
 * iff fingerprint matches; throws idempotencyReplayMismatch on mismatch.
 * Returns null if there is no prior record (fresh request).
 */
export async function lookupIdempotency(
  apiKeyId: string,
  key: string,
  fingerprint: string,
): Promise<IdempotencyHit | null> {
  const rows = await db
    .select()
    .from(apiIdempotencyKeys)
    .where(
      and(
        eq(apiIdempotencyKeys.apiKeyId, apiKeyId),
        eq(apiIdempotencyKeys.key, key),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const ageMs = Date.now() - new Date(row.createdAt).getTime();
  if (ageMs > REPLAY_WINDOW_MS) {
    // Stale — treat as fresh; the cron will evict it.
    return null;
  }

  if (row.fingerprint !== fingerprint) {
    throw apiErrors.idempotencyReplayMismatch();
  }

  return { status: row.status, body: row.body };
}

/**
 * Persist a successful response so the next replay returns it verbatim.
 * Only success (2xx) is stored — see docs/api/02-conventions.md.
 */
export async function storeIdempotency(
  apiKeyId: string,
  key: string,
  fingerprint: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (status < 200 || status >= 300) return;
  try {
    await db.insert(apiIdempotencyKeys).values({
      apiKeyId,
      key,
      fingerprint,
      status,
      body: body as object,
    });
  } catch {
    // Race: another concurrent replay won the insert. Acceptable.
  }
}
