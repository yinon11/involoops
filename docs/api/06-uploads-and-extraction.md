# Spec 06 — Uploads & Asynchronous Extraction

## Why a separate spec

Uploads are the one place where the API touches big, slow work (S3 transfer + PDF extraction + LLM call). Done naively, one integrator's batch can starve the rest. This spec pins down the flow so the bottlenecks stay predictable.

## Flow

```
client                         api                       s3                    extraction worker
  |  POST /uploads               |                         |                         |
  |----------------------------->|                         |                         |
  |                              | presign                 |                         |
  |                              |   (uploads/route.ts)    |                         |
  |   201 { upload_id, url }     |                         |                         |
  |<-----------------------------|                         |                         |
  |  PUT url (S3 direct)                                   |                         |
  |------------------------------------------------------->|                         |
  |                              |                         |                         |
  |  POST /uploads/{id}/process  |                         |                         |
  |----------------------------->| enqueue                 |                         |
  |   202 { status: "queued" }   |                         |                         |
  |<-----------------------------|                         |                         |
  |                              |                         |                         |
  |                              |              job picked up, runs processInvoice() |
  |                              |              writes invoice row, emits webhook    |
  |                              |                                                   |
  |  webhook invoice.processed   |                                                   |
  |<=============================+===================================================|
  |
  |  GET /uploads/{id}  (or follow the webhook payload) → final state
```

## Why three calls, not one

- Step 1 (`POST /uploads`) is cheap; ok to rate-limit tightly.
- Step 2 (`PUT` to S3) uses the customer's bandwidth and zero of ours.
- Step 3 (`POST /uploads/{id}/process`) is where we spend CPU/LLM. Separating it lets us rate-limit *work*, not *intent*.
- A single call could combine 1 + 3 as a convenience, but not 2 — a proxied upload through Next would bottleneck the node.

## Synchronous vs. asynchronous

The existing `processUploadedFile()` in `src/actions/upload-actions.ts` is synchronous — it awaits the extraction inline. That's acceptable at low scale but wrong at high concurrency.

We introduce a lightweight queue **without adding a new service**:

1. A new `upload_jobs` table stores `(upload_id, user_id, status, attempts, locked_by, locked_until, created_at)`.
2. `POST /uploads/{id}/process` inserts a row with `status = "queued"` and returns 202 immediately.
3. A new cron route `/api/cron/extract-uploads` runs every minute, locks up to N jobs with `SELECT ... FOR UPDATE SKIP LOCKED`, runs them, writes the invoice row, emits `invoice.processed`.
4. In dev, a `NEXT_PUBLIC_EXTRACT_SYNC=1` flag runs extraction inline after `process` so integrators see results without waiting for the cron.

This is a pragmatic queue. If load grows, swap the cron for BullMQ or AWS SQS; the interface (`upload_jobs` table, status semantics) stays.

```ts
// src/db/schema/upload-jobs.ts
export const uploadJobs = pgTable("upload_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  apiKeyId: uuid("api_key_id"),             // null when created from the web app
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  hint: jsonb("hint"),                       // { type, vendor_id_hint, ... }
  status: text("status", { enum: ["queued", "processing", "done", "error"] }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lockedBy: text("locked_by"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  invoiceId: uuid("invoice_id"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byStatus: index("upload_jobs_status_idx").on(t.status, t.createdAt),
}));
```

## Limits and protections

- **Size:** 50 MB per file (`POST /uploads` rejects larger with 422). Matches current web-app limits; raise later if needed.
- **Page count:** 60-page PDF cap in `text-extractor.ts` stays — returns `422 pdf_too_long`.
- **Content-type allowlist:** `application/pdf`, `image/png`, `image/jpeg`, `image/webp`. Anything else → 415.
- **Quota:** counts against the daily extraction quota (Spec 03) at `process` time, not `upload` time.
- **Concurrency per user:** max 4 concurrent extractions per user. The cron picks jobs greedily but skips users already at the cap.
- **Idempotency:** `POST /uploads` requires `Idempotency-Key`. The file hash (SHA-256 of the PUT target) is also used on the `process` step to auto-dedupe repeats; the second process call returns the original job id.

## Storage keys

Keys follow the existing convention (`src/lib/storage.ts` → `buildFileKey`): `{userId}/{year}/{month}/{filename}`. The API adds a `api/` prefix under the user — `{userId}/api/{year}/{month}/{filename}` — so it's trivial to tell web vs. API uploads apart in logs and archival.

## Failure handling

- Extraction errors set `status = "error"`, `error_code` ∈ {`pdf_too_long`, `unreadable_pdf`, `llm_upstream`, `quota_exhausted`, `unknown`}, with `error_message` (safe to surface).
- `invoice.processed` webhook fires on **both** success and error. Consumers check the `data.status` and `data.error_code` fields.
- Dead-letter: after 3 attempts, the job stays in `error` with the last error captured; admins can manually retry from the dashboard.

## Why we keep presigned PUT

- **Bandwidth.** A 50 MB PDF shouldn't go through the Next.js node.
- **CSP/CORS.** The upload hits S3's own origin, which is already CORS-enabled in the current config.
- **Consistency.** The web app uses the same path — one code path to harden.

## Test-mode behavior

Test-mode keys can upload freely, but extraction runs in a **mock mode** that returns canned data (no LLM spend). A `meta.mock: true` field is added to the `invoice.processed` webhook payload so integrators know not to persist downstream.
