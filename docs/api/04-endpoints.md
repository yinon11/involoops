# Spec 04 — Endpoint Catalog

> Definitive contracts for v1. Each entry lists method, path, required scopes, idempotency requirement, and notes on the action it wraps.

## Conventions recap

- All paths are under `/api/v1`.
- Every endpoint requires `Authorization: Bearer ...`.
- "Scopes" lists the **required** scope; other scopes are ignored.
- "Idempotent?" — `req` = `Idempotency-Key` header required; `opt` = supported but not required; `n/a` = read-only.
- "Wraps" — the existing server action that runs the business logic. The route handler authenticates, validates the body (Zod), calls the action, serializes the result.

---

## Health & meta

### `GET /health`
- Scopes: none (public).
- Returns `{ "status": "ok", "version": "1.0.0", "request_id": "..." }`.
- Used by load balancer probes; deliberately cheap.

### `GET /me`
- Scopes: `me:read`.
- Returns the user, plan, scopes on the calling key, and current usage:
  ```json
  {
    "user": { "id": "...", "email": "...", "name": "...", "display_currency": "ILS" },
    "business_entity": { "id": "...", "legal_name": "...", "osek_murshe": "..." },
    "api_key": { "id": "...", "name": "Production", "mode": "live", "scopes": ["..."] },
    "plan": { "id": "pro", "daily_quota": 100000 },
    "usage_today": { "requests": 8421, "extractions": 12 }
  }
  ```

### `GET /openapi.json`
- Scopes: none (public).
- The full OpenAPI 3.1 spec, generated from the Zod schemas at build time. See Spec 07.

---

## Business entity

### `GET /business-entity`
- Scopes: `me:read`. Returns the calling user's entity (one per user today).

---

## Outbound invoices (the invoice generator)

### `GET /outbound-invoices`
- Scopes: `outbound:read`.
- Filters: `status`, `document_type`, `customer_id`, `tax_year`, `date_from`, `date_to`, `shaam_status`, `q` (free-text on customer name + invoice number).
- Sort: `-invoice_date` (default), `-created_at`, `-total`.
- Cursor pagination (limit 50, max 200).
- Wraps `getOutboundInvoices(filters)`.

### `POST /outbound-invoices`
- Scopes: `outbound:write`. Idempotency: `req`.
- Body:
  ```json
  {
    "document_type": "tax_invoice",
    "customer_id": "uuid",
    "template_id": "uuid",
    "invoice_date": "2026-04-20",
    "due_date": "2026-05-20",
    "language": "he",
    "currency": "ILS",
    "vat_rate": "0.18",
    "items": [
      { "description": "Consulting — April", "quantity": "10", "unit_price": "450.00" }
    ],
    "notes": "Net-30."
  }
  ```
- Server computes line totals, subtotal, vat, total. Status starts as `draft`.
- Wraps `createOutboundInvoice()`.
- Returns `201` with the full document.

### `GET /outbound-invoices/{id}`
- Scopes: `outbound:read`.

### `PATCH /outbound-invoices/{id}`
- Scopes: `outbound:write`. Idempotency: `opt`. `If-Match: <version>` recommended.
- Allowed only when `status = "draft"`. Returns `409 document_immutable` otherwise.
- Wraps `updateOutboundInvoiceDraft()`.

### `DELETE /outbound-invoices/{id}`
- Scopes: `outbound:write`.
- Soft-deletes drafts only. A draft that already holds a number (an issue the Tax Authority refused) returns `409 document_immutable`: issue it, or cancel it through the refusal options. Wraps `deleteOutboundInvoice()`.

### `POST /outbound-invoices/{id}/issue`
- Scopes: `outbound:issue`. Idempotency: `req`.
- Allocates the next gapless number, computes signature, appends audit entry, flips status → `issued`. Returns the document with `formatted_number`, `pdf_url` (signed, 5-min TTL), `version` bumped.
- Concurrency: serialized per `(business_entity, document_type, tax_year)`. Returns `429 issue_path_busy` when the per-entity issue limit is hit.
- Period-locked invoice dates → `409 period_locked`.
- Wraps `issueOutboundInvoice()`.

### `POST /outbound-invoices/{id}/send`
- Scopes: `outbound:issue`. Idempotency: `req`.
- Body: `{ "to": ["client@example.com"], "cc": ["..."], "subject": "...", "body": "..." }` — all optional; defaults computed from the customer + template.
- Sends via SES, sets status → `sent` (if not already).
- Returns the message id and the resulting status.

### `POST /outbound-invoices/{id}/mark-paid`
- Scopes: `outbound:issue`. Idempotency: `req`.
- Body: `{ "paid_at": "2026-04-22", "payments": [...] }`.
- Wraps `updateOutboundInvoiceStatus(id, "paid", payments)`.

### `POST /outbound-invoices/{id}/void`
- Scopes: `outbound:issue`. Idempotency: `req`.
- Body: `{ "reason": "..." }`.
- Receipts, proformas and delivery notes only. A tax invoice, tax invoice-receipt or credit invoice returns `422 cannot_void_document_type`: cancel it with a credit note (below).

### `POST /outbound-invoices/{id}/credit-note`
- Scopes: `outbound:issue`. Idempotency: `req`.
- Issues a reverse charge against the source document. Body lets caller specify partial amounts.
- Wraps `issueCreditNote()`. Updates the source's `net_of_credits_amount`.

### `GET /outbound-invoices/{id}/pdf`
- Scopes: `outbound:read`.
- Returns `{ "url": "https://involoops.com/api/v1/outbound-invoices/{id}/pdf/file?token=...", "expires_in_seconds": 300 }`. The link streams the PDF from the app and expires after 5 minutes. No Authorization header is required on that second GET.

### `GET /outbound-invoices/{id}/audit`
- Scopes: `audit:read`.
- Returns the document's audit timeline (Spec 02 in `ita-compliance/`). Cursor paginated.

---

## Customers

### `GET /customers`
- Scopes: `customers:read`. Filters: `q` (name/email), `tax_id`. Sort: `-created_at`.

### `POST /customers`
- Scopes: `customers:write`. Idempotency: `req`.
- Body: `{ name, email?, phone?, address?, tax_id?, notes? }`.
- Unique on `(user_id, name)` — duplicates return `409 conflict` with the existing id.

### `GET / PATCH / DELETE /customers/{id}`
- Standard CRUD. `DELETE` blocks if the customer is referenced by any outbound invoice (return `409 in_use`); use soft-delete or merge.

---

## Templates

### `GET /invoice-templates`, `POST`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`
- Scopes: `templates:read` / `templates:write`.
- Body fields: `name`, `default_currency`, `default_language`, `design` (JSONB pass-through; documented separately for stability).
- Wraps `getTemplates`, `upsertTemplate`, `deleteTemplate`.

---

## Inbound invoices (expenses)

### `GET /invoices`
- Scopes: `invoices:read`.
- Filters: `status`, `vendor_id`, `vendor_ids` (multi), `type` (`expense`/`income`), `year`, `month`, `months` (multi), `date_from`, `date_to`, `q`, `unlinked_vendor_only`.
- Sort: `-invoice_date`, `-created_at`, `-amount`. Cursor paginated.

### `GET /invoices/{id}`, `PATCH /invoices/{id}`, `DELETE /invoices/{id}`
- Scopes: `invoices:read` / `invoices:write`.

### `POST /invoices/{id}/approve` and `/reject`
- Scopes: `invoices:write`. Idempotency: `req`.
- Body for reject: `{ "reason": "..." }`.

### `POST /invoices/{id}/re-extract`
- Scopes: `invoices:write`. Idempotency: `req`.
- Triggers the extraction pipeline against the stored file. Asynchronous: returns `202` with a `processing_id`; final state arrives via webhook (`invoice.processed`) or polled via `GET /uploads/{id}`.

---

## Uploads (extraction)

### `POST /uploads`
- Scopes: `uploads:write`. Idempotency: `req`.
- Body: `{ "file_name": "april-receipts.pdf", "content_type": "application/pdf", "size_bytes": 12345 }`.
- Returns:
  ```json
  {
    "upload_id": "uuid",
    "url": "https://s3.../signed-put",
    "method": "PUT",
    "headers": { "Content-Type": "application/pdf" },
    "expires_at": "..."
  }
  ```
- Re-uses the same `presign:<userId>` rate-limit + monthly quota gates as the in-app upload flow.

### `POST /uploads/{upload_id}/process`
- Scopes: `uploads:write`. Idempotency: `req`.
- Body: `{ "type": "expense" | "income", "vendor_id_hint": "..." }` (both optional).
- Confirms the S3 object exists, enqueues extraction. Returns `202` with `{ upload_id, status: "queued" }`.
- Webhook `invoice.processed` fires when done; clients can also poll.

### `GET /uploads/{upload_id}`
- Scopes: `uploads:write` (or `invoices:read`).
- Returns `{ status, error?, invoice_id?, extracted: {...} }`.

---

## Vendors

### `GET /vendors`, `POST`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`
- Scopes: `vendors:read` / `vendors:write`.
- Filters: `q`, `is_income_source`, `tracking_excluded`.

### `POST /vendors/{id}/aliases`
- Body: `{ "alias": "..." }`. Adds to the alias array. Idempotent on the value.

### `POST /vendors/{id}/merge`
- Body: `{ "into_vendor_id": "..." }`. Reassigns invoices, deletes the source. Audit-logged.

---

## Compliance read-only

### `GET /audit/entries`
- Scopes: `audit:read`.
- Filters: `business_entity_id`, `document_id`, `event_type`, `actor_user_id`, `date_from`, `date_to`. Cursor paginated.
- Wraps `listAuditEntries`.

### `GET /audit/verify-chain`
- Scopes: `audit:read`. Returns `{ ok, last_verified_sequence, broken_at? }`.

### `GET /archive/objects`
- Scopes: `archive:read`. Filters: `business_entity_id`, `kind`. Cursor paginated.

### `GET /archive/objects/{id}/verify`
- Scopes: `archive:read`. Recomputes the SHA-256, compares. Returns `{ ok, expected, actual }`.

### `GET /shaam/submissions`, `GET /shaam/submissions/{id}`
- Scopes: `shaam:read`.
- Filters: `status`, `document_id`. Returns submission state, allocation number, retry count, error code.

---

## Webhook endpoints (management)

(Delivery and event payloads in Spec 05.)

### `GET /webhook-endpoints`
- Scopes: `webhooks:write`.

### `POST /webhook-endpoints`
- Scopes: `webhooks:write`. Idempotency: `req`.
- Body: `{ "url": "https://...", "events": ["outbound_invoice.issued", ...], "description": "..." }`.
- Server generates and returns a `signing_secret` **once**. Stored hashed, never displayed again.

### `GET / PATCH / DELETE /webhook-endpoints/{id}`
- Standard CRUD.

### `POST /webhook-endpoints/{id}/rotate-secret`
- Returns the new secret once. Old secret stays valid for a 24h grace.

---

## Status code summary per group

| Group | Common codes |
|---|---|
| Reads | 200, 401, 403, 404, 429 |
| Creates (drafts, customers, vendors, templates) | 201, 400, 401, 403, 409 (idempotency replay or unique conflict), 422, 429 |
| Issues / sends / status transitions | 200, 401, 403, 409 (state, period lock, immutability), 422, 429 (issue path), 502 (SHAAM upstream) |
| Uploads | 201 / 202, 401, 403, 409, 415, 422, 429 |
| Webhooks mgmt | 201, 200, 401, 403, 404, 409, 422 |

## Action-handler shape (reference)

```ts
// src/app/api/v1/outbound-invoices/[id]/issue/route.ts
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireApiKey(req, ["outbound:issue"]);
  return await withIdempotency(ctx, req, async () => {
    await enforceIssueLimit(ctx.businessEntity.id, /* documentType */ undefined, /* taxYear */ undefined);
    const issued = await issueOutboundInvoice({ id: params.id, userId: ctx.user.id });
    return { status: 200, body: serializeOutboundInvoice(issued) };
  });
}
```

This pattern stays the same across endpoints. If a route does not require idempotency (`GET`), `withIdempotency` is omitted.
