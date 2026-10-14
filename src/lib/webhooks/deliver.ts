import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import type { WebhookDeliveryRow, WebhookEndpointRow } from "@/db/schema/webhooks";
import { eq, sql } from "drizzle-orm";
import { decryptSecret, signPayload } from "./signing";
import { assertPublicHttpUrl, WebhookUrlRejectedError } from "./ssrf";

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_SNIPPET = 4_096;
const MAX_ATTEMPTS = 8;
const AUTO_DISABLE_AFTER = 50;

/**
 * Exponential backoff (seconds) keyed by attempt number (1-based).
 * Mirrors docs/api/05-webhooks.md — 30s → 24h.
 */
const BACKOFF_SEC: readonly number[] = [
  30, 120, 600, 1800, 7200, 21600, 43200, 86400,
];

function backoffFor(attempts: number): number {
  const idx = Math.min(attempts - 1, BACKOFF_SEC.length - 1);
  return BACKOFF_SEC[Math.max(0, idx)];
}

/**
 * Inputs executeDelivery needs; lets the cron loop and the inline
 * test-delivery endpoint share the same function. A "test" delivery
 * skips the endpoint-level failure counter so probing doesn't
 * auto-disable a healthy production endpoint.
 */
interface ExecuteInput {
  delivery: Pick<
    WebhookDeliveryRow,
    "id" | "endpointId" | "eventId" | "eventType" | "payload" | "attempts"
  >;
  isTest?: boolean;
}

export interface ExecuteResult {
  ok: boolean;
  /** Terminal state written back to the row. */
  outcome: "delivered" | "retry_scheduled" | "dead";
  deliveryId: string;
  attempts: number;
  responseStatus: number | null;
  responseSnippet: string | null;
  error: string | null;
}

/** Run one delivery end-to-end: HTTP POST, update row, bump counters. */
export async function executeDelivery(
  input: ExecuteInput,
): Promise<ExecuteResult> {
  const row = input.delivery;
  const attempts = row.attempts + 1;

  const endpoint = await loadEndpoint(row.endpointId);
  if (!endpoint) {
    await markDead(row.id, "endpoint_missing");
    return result({
      ok: false,
      outcome: "dead",
      deliveryId: row.id,
      attempts,
      error: "endpoint_missing",
    });
  }
  if (!endpoint.active || endpoint.disabledAt) {
    await markDead(row.id, "endpoint_inactive");
    return result({
      ok: false,
      outcome: "dead",
      deliveryId: row.id,
      attempts,
      error: "endpoint_inactive",
    });
  }

  let urlOk: URL;
  try {
    urlOk = await assertPublicHttpUrl(endpoint.url);
  } catch (e) {
    const reason =
      e instanceof WebhookUrlRejectedError ? e.reason : "bad_url";
    await recordFailure(row.id, attempts, `ssrf:${reason}`, null, null);
    if (!input.isTest) {
      await bumpEndpointFailure(row.endpointId, `ssrf:${reason}`);
    }
    return result({
      ok: false,
      outcome: "retry_scheduled",
      deliveryId: row.id,
      attempts,
      error: `ssrf:${reason}`,
    });
  }

  const rawBody = JSON.stringify(row.payload);
  const plaintextSecret = decryptSecret({
    ciphertext: endpoint.secretCiphertext,
    iv: endpoint.secretIv,
    tag: endpoint.secretTag,
  });
  const sig = signPayload(rawBody, plaintextSecret);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DELIVERY_TIMEOUT_MS,
  );

  let responseStatus: number | null = null;
  let responseSnippet: string | null = null;
  let errorMessage: string | null = null;

  try {
    const resp = await fetch(urlOk.toString(), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "user-agent": "InvoLoops-Webhook/1.0",
        "x-involoops-signature": sig.header,
        "x-involoops-event-id": row.eventId,
        "x-involoops-event-type": row.eventType,
        "x-involoops-delivery": row.id,
        "x-involoops-attempt": String(attempts),
        ...(input.isTest ? { "x-involoops-test": "true" } : {}),
      },
      body: rawBody,
    });
    responseStatus = resp.status;
    try {
      const text = await resp.text();
      responseSnippet = text.slice(0, MAX_RESPONSE_SNIPPET);
    } catch {
      responseSnippet = null;
    }
  } catch (e) {
    errorMessage =
      e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  } finally {
    clearTimeout(timeout);
  }

  const ok =
    responseStatus !== null &&
    responseStatus >= 200 &&
    responseStatus < 300;

  if (ok) {
    await markDelivered(row.id, attempts, responseStatus, responseSnippet);
    if (!input.isTest) {
      await recordEndpointSuccess(row.endpointId);
    }
    return result({
      ok: true,
      outcome: "delivered",
      deliveryId: row.id,
      attempts,
      responseStatus,
      responseSnippet,
    });
  }

  const reason = errorMessage ?? `http_${responseStatus}`;
  if (attempts >= MAX_ATTEMPTS || input.isTest) {
    await markDead(row.id, errorMessage ?? "max_attempts");
    if (!input.isTest) {
      await bumpEndpointFailure(row.endpointId, reason);
    }
    return result({
      ok: false,
      outcome: "dead",
      deliveryId: row.id,
      attempts,
      responseStatus,
      responseSnippet,
      error: reason,
    });
  }
  await recordFailure(
    row.id,
    attempts,
    errorMessage,
    responseStatus,
    responseSnippet,
  );
  await bumpEndpointFailure(row.endpointId, reason);
  return result({
    ok: false,
    outcome: "retry_scheduled",
    deliveryId: row.id,
    attempts,
    responseStatus,
    responseSnippet,
    error: reason,
  });
}

function result(r: {
  ok: boolean;
  outcome: ExecuteResult["outcome"];
  deliveryId: string;
  attempts: number;
  responseStatus?: number | null;
  responseSnippet?: string | null;
  error?: string | null;
}): ExecuteResult {
  return {
    ok: r.ok,
    outcome: r.outcome,
    deliveryId: r.deliveryId,
    attempts: r.attempts,
    responseStatus: r.responseStatus ?? null,
    responseSnippet: r.responseSnippet ?? null,
    error: r.error ?? null,
  };
}

/**
 * Claim and process up to `batchSize` pending deliveries. Uses
 * `FOR UPDATE SKIP LOCKED` so multiple worker invocations don't step on
 * each other. Returns summary counts.
 */
export async function runWebhookDeliveryBatch(
  batchSize: number = 25,
): Promise<{ processed: number; delivered: number; failed: number; dead: number }> {
  let delivered = 0;
  let failed = 0;
  let dead = 0;

  const claimed = await db.transaction(async (tx) => {
    const rows: {
      id: string;
      endpointId: string;
      userId: string;
      eventId: string;
      eventType: string;
      payload: unknown;
      attempts: number;
    }[] = (await tx.execute(
      sql`
        SELECT id, endpoint_id AS "endpointId", user_id AS "userId",
               event_id AS "eventId", event_type AS "eventType", payload, attempts
        FROM webhook_deliveries
        WHERE status = 'pending' AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `,
    )) as never;

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    // Mark as in-flight so another worker won't re-claim even without SKIP LOCKED.
    await tx
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() + 10 * 60 * 1000) })
      .where(sql`${webhookDeliveries.id} IN ${ids}`);

    return rows;
  });

  for (const row of claimed) {
    try {
      const r = await executeDelivery({ delivery: row });
      if (r.outcome === "delivered") delivered += 1;
      else if (r.outcome === "dead") dead += 1;
      else failed += 1;
    } catch (err) {
      console.error("[webhooks] delivery failed unexpectedly", {
        deliveryId: row.id,
        err: err instanceof Error ? err.message : String(err),
      });
      await recordFailure(
        row.id,
        row.attempts + 1,
        err instanceof Error ? err.message : String(err),
        null,
        null,
      );
      failed += 1;
    }
  }

  return { processed: claimed.length, delivered, failed, dead };
}

async function loadEndpoint(
  id: string,
): Promise<WebhookEndpointRow | null> {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function markDelivered(
  id: string,
  attempts: number,
  status: number | null,
  snippet: string | null,
) {
  const now = new Date();
  await db
    .update(webhookDeliveries)
    .set({
      status: "delivered",
      attempts,
      deliveredAt: now,
      nextAttemptAt: now,
      lastResponseStatus: status,
      lastResponseSnippet: snippet,
      lastError: null,
    })
    .where(eq(webhookDeliveries.id, id));
}

async function recordFailure(
  id: string,
  attempts: number,
  error: string | null,
  status: number | null,
  snippet: string | null,
) {
  const next = new Date(Date.now() + backoffFor(attempts) * 1000);
  await db
    .update(webhookDeliveries)
    .set({
      status: "pending",
      attempts,
      nextAttemptAt: next,
      lastResponseStatus: status,
      lastResponseSnippet: snippet,
      lastError: error ? error.slice(0, 1000) : null,
    })
    .where(eq(webhookDeliveries.id, id));
}

async function markDead(id: string, error: string) {
  await db
    .update(webhookDeliveries)
    .set({
      status: "dead",
      lastError: error.slice(0, 1000),
    })
    .where(eq(webhookDeliveries.id, id));
}

async function recordEndpointSuccess(endpointId: string) {
  const now = new Date();
  await db
    .update(webhookEndpoints)
    .set({
      lastDeliveryAt: now,
      lastSuccessAt: now,
      consecutiveFailures: 0,
    })
    .where(eq(webhookEndpoints.id, endpointId));
}

async function bumpEndpointFailure(endpointId: string, reason: string) {
  await db
    .update(webhookEndpoints)
    .set({
      lastDeliveryAt: new Date(),
      consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
    })
    .where(eq(webhookEndpoints.id, endpointId));

  // Auto-disable after AUTO_DISABLE_AFTER consecutive failures. Raw
  // UPDATE keeps the predicate atomic with the counter check.
  await db.execute(sql`
    UPDATE webhook_endpoints
    SET disabled_at = now(),
        disabled_reason = ${reason.slice(0, 255)},
        active = false
    WHERE id = ${endpointId}
      AND disabled_at IS NULL
      AND consecutive_failures >= ${AUTO_DISABLE_AFTER}
  `);
}
