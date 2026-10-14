# Spec 05 — Webhooks

## Why

The extraction pipeline, SHAAM submission, and email delivery are all asynchronous. Polling burns request quota and is ugly. Webhooks let integrators subscribe once and receive events as they happen.

## Event catalog (v1)

| Event | When |
|---|---|
| `invoice.processed` | Extraction pipeline finished (success or error). |
| `invoice.approved` / `invoice.rejected` | Status transition (manual or auto). |
| `outbound_invoice.created` | New draft via API or UI. |
| `outbound_invoice.issued` | Signed and assigned a gapless number. |
| `outbound_invoice.sent` | SES handed to recipient. |
| `outbound_invoice.delivered` / `.bounced` / `.complained` | From SES bounce/complaint pipeline (`/api/webhooks/ses`). |
| `outbound_invoice.paid` | `mark-paid` succeeded. |
| `outbound_invoice.voided` | Document voided. |
| `outbound_invoice.credit_note_issued` | Credit note created against this document. |
| `shaam.submission.updated` | Allocation status changed (PENDING → APPROVED/REJECTED/HELD). |
| `customer.created` / `.updated` / `.deleted` | Customer lifecycle. |
| `vendor.created` / `.merged` | Vendor lifecycle. |
| `api_key.revoked` | Key revoked (sent to *other* keys, not the revoked one). |

We add events conservatively. New events are always additive; we never reshape an existing event without a major version bump (the event payload includes `"version": 1`).

## Payload shape

```json
{
  "id": "evt_01HX...",
  "type": "outbound_invoice.issued",
  "version": 1,
  "created_at": "2026-04-20T10:30:00+03:00",
  "live_mode": true,
  "api_version": "v1",
  "data": {
    "outbound_invoice": { /* same shape as GET /outbound-invoices/{id} */ }
  },
  "previous_attributes": null,
  "request": { "id": "req_01HX...", "idempotency_key": "..." }
}
```

For `*.updated` events, `previous_attributes` is a sparse object of the changed fields' prior values (helpful for diffing without re-fetching).

## Delivery semantics

- **At-least-once.** Consumers must be idempotent on `event.id`.
- **In-order per resource is best-effort.** We deliver in event-creation order per `(endpoint, resource_id)`; if the consumer rejects an event, retries continue until success or max attempts (the next event for the same resource queues behind it).
- **Retries:** exponential backoff — 30 s, 2 m, 10 m, 30 m, 2 h, 6 h, 12 h, 24 h, then dead-letter. Max 8 attempts.
- **Timeout:** 10 s connect+read. Anything else counts as failure.
- **Concurrency budget:** per endpoint, max 4 concurrent in-flight deliveries (so a slow consumer can't tar-pit the worker pool).

## Signing

Every delivery includes:

```
X-Involoops-Signature: t=1745151600,v1=hex(hmac_sha256(secret, t + "." + raw_body))
X-Involoops-Event-Id: evt_01HX...
X-Involoops-Event-Type: outbound_invoice.issued
X-Involoops-Delivery: del_01HX...
X-Involoops-Attempt: 1
User-Agent: InvoLoops-Webhook/1.0
```

Verification (Node example, also documented on the docs page):

```ts
const [tPart, vPart] = sigHeader.split(",");
const t = Number(tPart.split("=")[1]);
const sent = vPart.split("=")[1];
if (Math.abs(Date.now() / 1000 - t) > 300) throw new Error("stale");
const expected = crypto
  .createHmac("sha256", secret)
  .update(`${t}.${rawBody}`)
  .digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(sent, "hex"), Buffer.from(expected, "hex"))) {
  throw new Error("bad signature");
}
```

The 5-minute clock skew window prevents replay of captured deliveries. Consumers should also dedupe on `X-Involoops-Event-Id`.

## DB schema (new)

```ts
// src/db/schema/webhook-endpoints.ts
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  description: text("description"),
  events: text("events").array().notNull(),         // ["outbound_invoice.*"] or specific
  secretHash: text("secret_hash").notNull(),         // HMAC-SHA-256(secret, pepper)
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
});

// src/db/schema/webhook-deliveries.ts
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpointId: uuid("endpoint_id").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status", { enum: ["pending", "delivered", "failed", "dead"] }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  lastResponseStatus: integer("last_response_status"),
  lastResponseSnippet: text("last_response_snippet"),  // first 4 KiB
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
}, (t) => ({
  byEndpointStatus: index("wd_endpoint_status_idx").on(t.endpointId, t.status, t.nextAttemptAt),
  byEvent: index("wd_event_idx").on(t.eventId),
}));
```

`secret` is stored in the same way as API-key secrets (HMAC + pepper), generated and shown to the user once.

## Worker

A new `/api/cron/webhook-deliveries` route (Bearer `CRON_SECRET`, like the other crons) runs every minute, locks up to N pending deliveries via `SELECT ... FOR UPDATE SKIP LOCKED`, dispatches HTTP, updates status. The worker can be moved to a dedicated process later; the route boundary keeps it deployable today.

Outgoing HTTP uses a small fetch client with:
- `keep-alive`, connection pool capped per host.
- Per-host concurrency cap (4) so one buggy endpoint can't drown the worker.
- Per-endpoint circuit breaker: after 50 consecutive failures, mark `active = false` and email the user.

## "Auto-disable" policy

After 50 consecutive failures **or** 7 days with no `2xx`, the endpoint flips to `active = false`. The user gets an email + dashboard banner. We never silently drop events for an active endpoint.

## Test deliveries

`POST /webhook-endpoints/{id}/test` (scope `webhooks:write`) sends a synthetic `event.test` to the endpoint immediately, returns the response. Useful for setup and ngrok dev loops.

## Replay

Admin (and the user, scoped to their endpoints) can replay a delivery by id from the dashboard. The replay carries a fresh delivery id but the same `event.id`, so consumers dedupe correctly.

## Privacy

Webhook payloads are bounded — large fields (extracted text, raw OCR) are omitted from the event and fetchable via the API. PDFs are referenced by id, never inlined. Customer PII (name, email) is included only when relevant to the event (the integrator already has access via the API).
