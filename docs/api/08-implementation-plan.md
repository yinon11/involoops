# Spec 08 — Implementation Plan

## Phasing principle

Ship the **smallest end-to-end loop** first, then widen. Each phase ends in something a real integrator can use.

## Phase 0 — Foundations (no public surface yet)

Estimated: 3–4 days.

- New tables (Drizzle migrations):
  - `api_keys` (Spec 01)
  - `api_idempotency_keys` (Spec 02)
  - `webhook_endpoints`, `webhook_deliveries` (Spec 05)
  - `upload_jobs` (Spec 06)
  - `api_request_log` (Spec 09; partitioned monthly to keep it cheap)
- New env vars in `.env.example`:
  - `API_KEY_PEPPER` (required) — 32 bytes hex, server-only.
  - `API_PUBLIC_BASE_URL` (e.g., `https://api.involoops.com`).
  - `WEBHOOK_USER_AGENT` — defaults to `InvoLoops-Webhook/1.0`.
- New shared modules:
  - `src/lib/api/authenticate.ts` — `requireApiKey(req, scopes[])`.
  - `src/lib/api/idempotency.ts` — `withIdempotency(ctx, req, fn)`.
  - `src/lib/api/errors.ts` — RFC-7807 builders + the `code` enum.
  - `src/lib/api/serializers/*.ts` — one per resource (outbound, customer, vendor, …).
  - `src/lib/api/rate-limit.ts` — wraps `enforceRateLimit` with the multi-bucket helper from Spec 03.
- Update `src/proxy.ts` (was `src/middleware.ts`) to add `/api/v1/*` to the public allowlist for the **session check** (the API does its own auth). The existing `/api/files/preview` exemption is the precedent.
- Server actions for key management (`src/actions/api-key-actions.ts`).
- Settings page route: `src/app/(app)/settings/api-keys/`.

Deliverable: a user can create an API key in the dashboard. Nothing accepts it yet.

## Phase 1 — Read-only reference loop

Estimated: 3 days.

- Implement `GET /api/v1/health`, `GET /api/v1/me`, `GET /api/v1/business-entity`.
- Implement read endpoints for outbound invoices, customers, templates, vendors, inbound invoices.
- Cursor pagination helper (`src/lib/api/pagination.ts`).
- Generate first OpenAPI spec, host at `/api/v1/openapi.json`.
- Stand up `/developers/reference` with Scalar.
- Internal smoke test: cURL through every read endpoint.

Deliverable: third-party integrators can read everything they own.

## Phase 2 — Outbound invoice writes (the marquee feature)

Estimated: 4–5 days.

- `POST /outbound-invoices`, `PATCH`, `DELETE`.
- `POST /outbound-invoices/{id}/issue` with `enforceIssueLimit`.
- `POST /outbound-invoices/{id}/send`, `/mark-paid`, `/void`, `/credit-note`.
- `GET /outbound-invoices/{id}/pdf` (signed-URL response).
- `GET /outbound-invoices/{id}/audit`.
- Customers + templates writes.
- Idempotency wired everywhere a `POST` mutates.
- Quickstart guide written + verified end-to-end with a real test key.

Deliverable: a real integrator can do `create → issue → send → mark-paid` from the API.

## Phase 3 — Webhooks

Estimated: 3–4 days.

- Endpoint management routes (`/webhook-endpoints`).
- Event emitters wired into the existing actions: `issueOutboundInvoice`, `updateOutboundInvoiceStatus`, `processUploadedFile`, etc. Emit by inserting into `webhook_deliveries` (status `pending`).
- Worker: `/api/cron/webhook-deliveries` (Bearer `CRON_SECRET`), runs every minute. Documented in `AGENTS.md`'s cron section.
- Signing helpers + verification snippets in docs.
- Test-delivery endpoint.

Deliverable: integrators stop polling.

## Phase 4 — Uploads & async extraction

Estimated: 4 days.

- `POST /uploads`, `POST /uploads/{id}/process`, `GET /uploads/{id}`.
- `upload_jobs` queue + `/api/cron/extract-uploads` worker.
- `invoice.processed` webhook emission.
- Test-mode mock extractor.
- Vendors aliases / merge endpoints (small, batched here so the vendor surface is complete).

Deliverable: integrators can offload PDF intake to InvoLoops.

## Phase 5 — Compliance reads + polish

Estimated: 3 days.

- Audit, archive, SHAAM read endpoints.
- Plan-tier quota wiring against `usage_tracking`.
- Admin overrides UI for limits.
- Status page + alerts.
- Public docs site polish: recipes, error pages, changelog.

Deliverable: the API is "complete" by Spec 04 standards. v1 frozen, public launch announcement.

## Cross-cutting tasks (run in parallel from Phase 1 onward)

- **Tests:** integration tests under `tests/api/v1/` using a test database. Cover: auth, scope enforcement, idempotency replay, period locking, immutability, cursor stability, 429 semantics. We ship a `npm run test:api` script even though the repo doesn't have a test script today (per `AGENTS.md`).
- **Load test:** `k6` script that simulates 200 concurrent integrators doing realistic mixes. Target: p95 read < 200 ms, p95 issue < 800 ms, error rate < 0.1%, no 5xx storms.
- **Logging:** every request writes to `api_request_log` (request id, key id, route, status, latency_ms, rate-limit decision, idempotency replay flag).
- **Metrics:** counters per route + status; Prometheus-style endpoint at `/api/internal/metrics` (admin-only).
- **Docs:** every PR that touches `src/app/api/v1/` must update either the schema (which auto-updates OpenAPI) or one of the conceptual pages. Lint check in CI.

## Files we'll add (mirror the existing structure)

```
src/app/api/v1/
  health/route.ts
  me/route.ts
  business-entity/route.ts
  outbound-invoices/route.ts
  outbound-invoices/[id]/route.ts
  outbound-invoices/[id]/issue/route.ts
  outbound-invoices/[id]/send/route.ts
  outbound-invoices/[id]/mark-paid/route.ts
  outbound-invoices/[id]/void/route.ts
  outbound-invoices/[id]/credit-note/route.ts
  outbound-invoices/[id]/pdf/route.ts
  outbound-invoices/[id]/audit/route.ts
  customers/route.ts
  customers/[id]/route.ts
  invoice-templates/route.ts
  invoice-templates/[id]/route.ts
  invoices/route.ts
  invoices/[id]/route.ts
  invoices/[id]/approve/route.ts
  invoices/[id]/reject/route.ts
  invoices/[id]/re-extract/route.ts
  vendors/route.ts
  vendors/[id]/route.ts
  vendors/[id]/aliases/route.ts
  vendors/[id]/merge/route.ts
  uploads/route.ts
  uploads/[id]/route.ts
  uploads/[id]/process/route.ts
  audit/entries/route.ts
  audit/verify-chain/route.ts
  archive/objects/route.ts
  archive/objects/[id]/verify/route.ts
  shaam/submissions/route.ts
  shaam/submissions/[id]/route.ts
  webhook-endpoints/route.ts
  webhook-endpoints/[id]/route.ts
  webhook-endpoints/[id]/rotate-secret/route.ts
  webhook-endpoints/[id]/test/route.ts
  openapi.json/route.ts

src/app/api/cron/
  webhook-deliveries/route.ts
  extract-uploads/route.ts

src/app/(marketing)/developers/
  page.tsx                          # quickstart
  reference/page.tsx                # Scalar host
  changelog/page.tsx
  errors/[code]/page.tsx
  recipes/[slug]/page.tsx

src/app/(app)/settings/api-keys/
  page.tsx
  components/*.tsx

src/lib/api/
  authenticate.ts
  idempotency.ts
  rate-limit.ts
  pagination.ts
  errors.ts
  serializers/{outbound, customer, vendor, invoice, template, audit}.ts
  webhook-emitter.ts

src/db/schema/
  api-keys.ts
  api-idempotency-keys.ts
  api-request-log.ts
  webhook-endpoints.ts
  webhook-deliveries.ts
  upload-jobs.ts

scripts/
  generate-openapi.ts
  load-test.ts                      # k6 driver
```

## Migration order

1. Drizzle migration for the new tables (Phase 0).
2. Backfill: none — these are new.
3. Schema and code land before the routes that consume them; ship in small PRs (one per resource ideally).

## Risk register

| Risk | Mitigation |
|---|---|
| Single Node node can't handle 100s of concurrent users on heavy paths. | Issue path serializes per entity (already required); rate limits prevent thundering herds; webhook + extraction workers separated via cron; staged load test before announcing. |
| Drift between Zod schemas and runtime behavior. | Integration tests assert response shapes match schemas (zod-parse the response in the test). |
| API key leakage via logs. | `requireApiKey` strips secret before passing context; logger sanitizers redact `Authorization` and any `Bearer ` substring. |
| SHAAM upstream slowdown bleeds into API latency. | `issue` decouples submission: the API call signs + allocates synchronously, but SHAAM submission runs in a background job (existing pattern). API returns immediately. |
| Webhook consumer outages back-pressure the worker. | Per-endpoint concurrency cap + auto-disable after 50 failures. |
| Hand-written Markdown and Zod schemas drift. | Doc PRs link the touched schema files; CI checks for `routes touched without docs touched`. |
