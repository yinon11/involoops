# InvoLoops Public API — Plan Index

This folder is the **design** for the InvoLoops public REST API. No code is written yet; these documents are the blueprint we will build against.

## Read order

1. **`00-overview.md`** — Goals, principles, surface map, capacity target.
2. **`01-auth-and-api-keys.md`** — `inv_live_` / `inv_test_` keys, scopes, lifecycle, middleware.
3. **`02-conventions.md`** — Versioning, headers, RFC-7807 errors, cursor pagination, idempotency.
4. **`03-rate-limiting-and-quotas.md`** — Burst / sustained / concurrency / daily-quota tiers and headers.
5. **`04-endpoints.md`** — Full endpoint catalog with required scopes and idempotency rules.
6. **`05-webhooks.md`** — Event catalog, signed delivery, retries, schema.
7. **`06-uploads-and-extraction.md`** — Presigned uploads, async extraction queue, test-mode mocks.
8. **`07-openapi-and-docs-site.md`** — OpenAPI 3.1 generation from Zod, Scalar-rendered docs at `/developers`.
9. **`08-implementation-plan.md`** — Phased rollout, files to add, migration order, risk register.
10. **`09-security-checklist.md`** — Pre-launch gates: auth, transport, multi-tenancy, SSRF, logging.
11. **`10-mcp.md`** — MCP Streamable HTTP endpoint at `/api/mcp` (API-key auth, tool catalog).

## TL;DR for reviewers

- **Auth:** bearer API key (`Authorization: Bearer inv_live_<id>.<secret>`). Stored as HMAC-SHA-256 with a server-side pepper. Per-key scopes; deny-by-default.
- **URL shape:** `/api/v1/...` on `https://api.involoops.com` (also reachable at `https://app.involoops.com/api/v1`).
- **Errors:** RFC 7807 Problem Details, with `request_id` and a stable `code` enum.
- **Pagination:** cursor-based, default 50 / max 200, opaque `next_cursor`.
- **Writes:** `Idempotency-Key` required on all state-creating `POST`s.
- **Rate limits:** per key — 60/s burst, 1,000/min sustained, 8 in-flight, plan-tier daily quota; per-`(entity, doc_type, year)` issue-path semaphore protects gapless allocation.
- **Async work:** webhooks (HMAC-signed) and a polling fallback. Extraction runs in a `upload_jobs` queue drained by a cron worker.
- **Docs site:** OpenAPI generated from Zod schemas, rendered with Scalar at `/developers/reference`. Quickstart, error pages, recipes, changelog at `/developers`.
- **Compliance:** the API is a thin layer over existing server actions, so audit log, gapless numbering, period locking, and Spec-04 immutability all carry over.
- **Scale:** designed for hundreds of concurrent users today on single-node, with a one-line swap (rate limiter Map → Redis) to go multi-node.

## What this plan deliberately does **not** cover

- OAuth2 third-party authorization (only first-party API keys in v1).
- GraphQL or streaming.
- Server-streamed file downloads (we return signed URLs).
- An admin API (the `/admin/*` UI is unchanged).

## How this plan touches existing code

The API is additive — we are not rewriting actions, schemas, or middleware patterns. The new routes under `src/app/api/v1/` are thin wrappers that:

1. Authenticate the API key (`requireApiKey`).
2. Validate the body against a Zod schema.
3. Call the existing server action (`createOutboundInvoice`, `issueOutboundInvoice`, …).
4. Serialize the response with snake_case fields.

Everything compliance-related (audit log, gapless allocator, period locking, Spec-04 immutability) lives inside the actions, so the API inherits those guarantees by construction.

## Status

Planning. Work proceeds in the order described in `08-implementation-plan.md`, starting with Phase 0 (foundations: schema + auth middleware + key-management UI).
