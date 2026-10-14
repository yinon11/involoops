# InvoLoops Public API — Plan

> **Status:** Planning. No code yet — this is the design we will build against.
> **Audience:** implementers. Read `AGENTS.md` first.
> **Companion docs in this folder:**
> - `01-auth-and-api-keys.md` — API-key model, scopes, key lifecycle
> - `02-conventions.md` — versioning, pagination, errors, idempotency, headers
> - `03-rate-limiting-and-quotas.md` — limits per key, plan tiers, fairness
> - `04-endpoints.md` — full endpoint catalog (REST surface)
> - `05-webhooks.md` — async events and signature verification
> - `06-uploads-and-extraction.md` — presigned uploads + async extraction
> - `07-openapi-and-docs-site.md` — OpenAPI 3.1 spec + hosted docs page
> - `08-implementation-plan.md` — phased rollout, files to add, migrations
> - `09-security-checklist.md` — threat model + pre-launch gates

---

## 1. Goal

Expose a **secure, documented, programmatic interface** to InvoLoops so third-party clients can:

1. Issue legal invoices, receipts, credit notes (the "invoice generator" — outbound).
2. Read and manage customers, vendors, templates, business-entity settings.
3. Upload expense documents and receive extracted data via webhooks.
4. Reconcile audit, archive, and SHAAM submission state for compliance.

The API must safely serve **hundreds of concurrent users** on the existing single-node deployment and scale horizontally without redesign.

## 2. Non-goals

- Replacing the in-app session / cookie auth. The public API is a separate auth lane.
- Exposing internal admin endpoints (`/admin/*`, `/api/cron/*`, webhook receivers).
- Replacing direct S3 uploads with proxy uploads — we keep presigned URLs.
- A GraphQL surface. REST only, JSON only, for v1.

## 3. Design principles

| Principle | What it means here |
|---|---|
| **Secure by default** | API key required on every call. Scopes are deny-by-default. TLS only. |
| **Predictable** | Stable URLs (`/api/v1/...`), cursor pagination, RFC 7807 errors, ISO-8601 timestamps, ISO-4217 currencies, ISO-639 languages. |
| **Idempotent writes** | All `POST` / `PUT` accept an `Idempotency-Key` header; replays return the original response. |
| **Compliance-aware** | Issued documents are immutable per Spec 04. The API enforces the same transitions as the UI; no back doors. |
| **Tenant-isolated** | Every read/write scoped by `(apiKey → userId → businessEntityId)`. No cross-tenant access path. |
| **Observable** | Every request has a `request_id`, logged with key id, route, latency, status, rate-limit decision. |
| **Versioned** | URL-pathed `/v1`. New breaking versions ship as `/v2`. Deprecations announce via `Sunset` and `Deprecation` headers ≥6 months ahead. |

## 4. Surface area at a glance

```
GET    /api/v1/health
GET    /api/v1/me                          # who am I, plan, limits
GET    /api/v1/business-entity             # the issuing entity (1 per user today)
PATCH  /api/v1/business-entity

# Outbound (invoice generator) — primary surface
GET    /api/v1/outbound-invoices
POST   /api/v1/outbound-invoices           # create draft
GET    /api/v1/outbound-invoices/{id}
PATCH  /api/v1/outbound-invoices/{id}      # draft only
DELETE /api/v1/outbound-invoices/{id}      # draft only (soft)
POST   /api/v1/outbound-invoices/{id}/issue   # sign + allocate number (idempotent)
POST   /api/v1/outbound-invoices/{id}/send    # email via SES
POST   /api/v1/outbound-invoices/{id}/mark-paid
POST   /api/v1/outbound-invoices/{id}/void
POST   /api/v1/outbound-invoices/{id}/credit-note  # issue reverse charge
GET    /api/v1/outbound-invoices/{id}/pdf  # signed download URL
GET    /api/v1/outbound-invoices/{id}/audit

# Customers
GET    /api/v1/customers
POST   /api/v1/customers
GET    /api/v1/customers/{id}
PATCH  /api/v1/customers/{id}
DELETE /api/v1/customers/{id}

# Templates
GET    /api/v1/invoice-templates
POST   /api/v1/invoice-templates
GET    /api/v1/invoice-templates/{id}
PATCH  /api/v1/invoice-templates/{id}
DELETE /api/v1/invoice-templates/{id}

# Inbound expenses (read + manage)
GET    /api/v1/invoices
GET    /api/v1/invoices/{id}
PATCH  /api/v1/invoices/{id}
POST   /api/v1/invoices/{id}/approve
POST   /api/v1/invoices/{id}/reject
POST   /api/v1/invoices/{id}/re-extract
DELETE /api/v1/invoices/{id}

# Uploads (extraction pipeline)
POST   /api/v1/uploads                      # create the job, returns where to PUT
POST   /api/v1/uploads/{uploadId}/content   # send the file bytes
POST   /api/v1/uploads/{uploadId}/process   # confirm + start extraction
GET    /api/v1/uploads/{uploadId}           # status (queued/processing/done/error)

# Vendors
GET    /api/v1/vendors
POST   /api/v1/vendors
GET    /api/v1/vendors/{id}
PATCH  /api/v1/vendors/{id}
DELETE /api/v1/vendors/{id}
POST   /api/v1/vendors/{id}/aliases
POST   /api/v1/vendors/{id}/merge

# Compliance read-only
GET    /api/v1/audit/entries
GET    /api/v1/audit/verify-chain
GET    /api/v1/archive/objects
GET    /api/v1/archive/objects/{id}/verify
GET    /api/v1/shaam/submissions
GET    /api/v1/shaam/submissions/{id}

# Webhooks management
GET    /api/v1/webhook-endpoints
POST   /api/v1/webhook-endpoints
GET    /api/v1/webhook-endpoints/{id}
PATCH  /api/v1/webhook-endpoints/{id}
DELETE /api/v1/webhook-endpoints/{id}
POST   /api/v1/webhook-endpoints/{id}/rotate-secret

# Discovery
GET    /api/v1/openapi.json                 # OpenAPI 3.1 spec (public)
```

Detailed contracts (request/response shapes, scope requirements, idempotency, status codes) live in `04-endpoints.md`.

## 5. Why this fits the existing app

- **Server actions stay the source of truth.** Each REST route is a thin handler that authenticates the API key, resolves the user, calls the existing action (`createOutboundInvoice`, `issueOutboundInvoice`, etc.), and serializes the result. No domain logic moves.
- **Compliance invariants stay enforced.** `appendAuditEntry`, `document-number-sequences` (gapless allocation), period locking, and Spec-04 immutability all run inside the existing actions, so the API inherits them for free.
- **Storage flow.** Every upload is streamed through the app — API callers POST to `/api/v1/uploads/{id}/content`, the web app to `/api/upload/file`. Neither touches storage directly, so the bucket stays private and needs no public hostname. `POST /uploads` advertised a presigned S3 PUT URL until 2026-10-14; it was signed against `S3_ENDPOINT`, which has to be reachable by the caller, and storage has no public hostname — so that PUT failed at DNS and `/process` answered 409 "File has not finished uploading". `/content` already existed for the mobile app; it is now the only advertised path.
- **Rate limiter is reused.** `enforceRateLimit(key, max, windowSec)` already has the right shape; we add a `apikey:<id>` keyspace and swap the in-process Map for Redis when we go multi-node (the function signature stays the same — that swap is documented in `src/lib/rate-limit.ts:1-9`).

## 6. Capacity target

- **Steady state:** 100s of concurrent API users, mostly read traffic.
- **Per-key default:** 60 req/s burst, 1,000 req/min sustained, plan-gated daily quota.
- **Issue path bottleneck:** gapless number allocation serializes per `(businessEntityId, documentType, taxYear)`. That's correct and required — we surface it with a small queue + 429 backpressure rather than racing.
- **Single-node today, multi-node ready.** All shared state (rate limiter, idempotency cache) is designed to move to Redis without API changes.

## 7. Out of scope for v1 (explicit)

- OAuth2 third-party authorization (only first-party API keys in v1).
- Bulk import endpoints (use looped single creates with idempotency keys; revisit if needed).
- Real-time streaming (SSE/WebSockets). Use webhooks.
- File downloads streamed through the API. We return a short-lived signed URL instead.

## 8. Success criteria

1. A developer with an API key can issue a legal Israeli tax invoice end-to-end (`create → issue → send → mark-paid`) using only the public docs.
2. p95 latency for read endpoints < 200 ms; for `issue` < 800 ms (excluding SHAAM round-trip).
3. Zero cross-tenant data leak in fuzz/auth tests.
4. OpenAPI spec validates and round-trips through Scalar / Stoplight without warnings.
5. All write endpoints are idempotent under retry storms.
