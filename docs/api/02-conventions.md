# Spec 02 — API Conventions

## Versioning

- URL-pathed: `/api/v1/...`. v1 is the only version at launch.
- Breaking changes ship as `/v2`. v1 stays online for **≥12 months** after v2 GA.
- Additive changes (new optional fields, new endpoints) do **not** bump the version.
- Deprecation announces via response headers on the deprecated route:
  - `Deprecation: true`
  - `Sunset: <RFC 1123 date>`
  - `Link: <https://docs.involoops.com/api/migrating-v1-v2>; rel="deprecation"`

## Base URL

- Production: `https://api.involoops.com/v1` (CNAME / reverse proxy in front of the Next.js app).
- The same routes also resolve at `https://app.involoops.com/api/v1` so we can ship before the dedicated subdomain is provisioned. Docs always point to the dedicated host.

## Content type

- Request: `Content-Type: application/json; charset=utf-8`. We reject anything else with `415`.
- Response: `application/json` for everything except `/openapi.json` (still JSON, served with the same content type).
- All timestamps: ISO-8601 with offset (e.g., `2026-04-20T12:34:56+03:00`).
- All currencies: ISO-4217 uppercase (`ILS`, `USD`, `EUR`).
- All amounts: **string-encoded decimals** (`"1234.56"`) to avoid float drift. Server parses with the same `numeric(12,2)` precision as the DB.
- Booleans, enums, and nullables follow the OpenAPI spec — no string `"true"` / `"false"`.

## Required headers

| Header | Purpose |
|---|---|
| `Authorization: Bearer inv_(live\|test)_<id>.<secret>` | Auth (every call) |
| `Idempotency-Key: <ULID or UUID>` | Required on `POST` that creates state, optional on `PATCH/PUT/DELETE`. See below. |
| `X-Request-Id: <ULID>` | Optional. If absent, the server generates one and echoes in the response. |
| `User-Agent` | Strongly recommended; logged for support. |

## Response envelope

Successful responses are **the resource itself** at the top level — no double wrapping. List endpoints wrap with `data` + `page`:

```json
{
  "data": [ { "id": "...", "..." }, ... ],
  "page": {
    "next_cursor": "eyJpZCI6Ii4uLiJ9",
    "has_more": true,
    "limit": 50
  }
}
```

Single-resource responses include the resource fields directly.

## Errors — RFC 7807 Problem Details

```json
{
  "type": "https://docs.involoops.com/api/errors/validation_failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "items[0].quantity must be > 0",
  "code": "validation_failed",
  "request_id": "01HX5...",
  "errors": [
    { "path": "items.0.quantity", "message": "must be > 0" }
  ]
}
```

| HTTP | `code` examples | When |
|---|---|---|
| 400 | `bad_request`, `malformed_json` | Body unparseable / wrong shape |
| 401 | `missing_credentials`, `invalid_key`, `expired_key` | Auth |
| 403 | `missing_scope`, `ip_not_allowed`, `tenant_mismatch` | Authorized but not allowed |
| 404 | `not_found` | Resource missing or not visible to this key |
| 409 | `conflict`, `period_locked`, `document_immutable`, `idempotency_replay_mismatch` | State conflict |
| 415 | `unsupported_media_type` | Content-Type wrong |
| 422 | `validation_failed`, `currency_mismatch`, `customer_required`, `cannot_void_document_type` | Business validation |
| 426 | `tls_required` | Plain HTTP |
| 429 | `rate_limited`, `quota_exceeded` | Limits |
| 5xx | `internal_error`, `upstream_unavailable` | Server side |

Every error includes `request_id` so support can grep one log line.

`404` is also returned when the resource exists but belongs to another tenant — we never confirm existence across tenants.

## Pagination — cursor based

- Query params: `?limit=50&cursor=<opaque>`.
- `limit` default 50, max 200. Anything higher is clamped (no error) and the response sets `page.limit` to the actual value used.
- The cursor is an opaque base64-url-encoded JSON `{ "k": "<sort-key>", "id": "<tiebreaker>" }`. Clients must treat it as opaque.
- Sort is **deterministic and stable**: each list endpoint documents its sort (e.g., outbound invoices sort by `(invoice_date DESC, id DESC)`).
- Cursors stay valid even if rows are inserted or deleted — we use `(sort_key, id) > cursor` semantics, never `OFFSET`.

Why cursor over offset? Offset pagination breaks when rows shift (common during heavy concurrent writes) and gets slow on deep pages. Cursor scales O(1).

## Filtering & sorting

- Filters use bracketless query syntax: `?status=issued&document_type=tax_invoice&date_from=2026-01-01`.
- Multi-value filters use repeated keys: `?status=issued&status=sent` (NOT comma-joined; the OpenAPI spec is explicit).
- `?sort=-invoice_date` (descending) where supported. Each endpoint lists allowed sort keys.

## Idempotency

- Required on `POST` that creates state (create draft, issue, send, mark-paid, credit-note, customer create, etc.). Optional but supported on `PATCH/PUT/DELETE`.
- Header: `Idempotency-Key: <client-generated ULID>` (max 255 chars, `[A-Za-z0-9_-]`).
- Server stores `(api_key_id, idempotency_key)` → `request_fingerprint`, `response_status`, `response_body`, `created_at` for **24 hours**.
  - **Same key + same body** within window → original response replayed.
  - **Same key + different body** → `409 idempotency_replay_mismatch` (protects against accidental key reuse across distinct intents).
- Storage: new `api_idempotency_keys` table; entries TTL'd by a daily cron.

```ts
// src/db/schema/api-idempotency-keys.ts
export const apiIdempotencyKeys = pgTable("api_idempotency_keys", {
  apiKeyId: uuid("api_key_id").notNull(),
  key: text("key").notNull(),
  fingerprint: text("fingerprint").notNull(),  // sha256(method + path + canonicalized body)
  status: integer("status").notNull(),
  body: jsonb("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.apiKeyId, t.key] }),
  byCreated: index("api_idem_created_idx").on(t.createdAt),
}));
```

The handler wraps action calls so the original status + body are recorded after success — and so a 5xx is **not** stored (the next attempt should retry, not replay an error).

## Concurrency

- The gapless number allocator (`document-number-sequences`) already uses row-level locking. The API surfaces no new concurrency surface — the issue endpoint inherits the existing serialization point. If two API requests race for the same entity+type+year, one wins immediately, the other waits briefly. We document expected p95 < 800 ms.
- Optimistic concurrency for `PATCH /outbound-invoices/{id}` (drafts) via `If-Match: <version>` header → returns `409 conflict` if the row's `version` has advanced. The version field already exists on the table.

## CORS

- Public API allows cross-origin from any HTTPS origin: `Access-Control-Allow-Origin: *` for `/api/v1/*`, `Allow-Methods: GET, POST, PATCH, DELETE`, `Allow-Headers: Authorization, Content-Type, Idempotency-Key, X-Request-Id`, `Max-Age: 600`.
- Credentials mode is **not** allowed (`*` + credentials is a footgun and an API key is sent explicitly anyway).
- The interactive docs (Scalar) live on a same-origin path so its "Try it" calls don't hit CORS.

## Localization

- Responses are language-neutral. Where the user has a locale (`en` / `he`) we still return canonical English field names; user-facing strings (e.g., PDF rendering) honor the document's own `language` field.
- Currency formatting is the client's job; we always send the raw decimal + ISO code.

## Field naming

- `snake_case` for JSON property names (industry convention; matches Stripe / GitHub).
- Internal Drizzle camelCase is mapped at the serializer boundary (`src/lib/api/serializers/*`).
- IDs are UUIDv4 strings unless noted (sequence numbers are integers; `formatted_number` is a string like `"2026-TI-000001"`).
