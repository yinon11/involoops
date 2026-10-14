# Spec 08 — SHAAM Invoice Submission

Archive copy. Canonical source: conversation transcript.

## Summary

Every qualifying outbound document is submitted to the ITA clearance
API during issuance. The allocation number returned by SHAAM lands
on the `outbound_invoices` row and on the PDF. Rejections, held
states, and outages are all first-class outcomes with distinct UI
affordances — an outage never blocks issuance.

## What landed

- **Schema** — `outbound_invoices` grows `shaam_status`, `allocation_number`,
  `shaam_submitted_at`, `shaam_response_at`, `shaam_action_code`,
  `shaam_idempotency_key`, `shaam_request_id`, `shaam_last_error_*`,
  `shaam_retry_count`. New `shaam_submissions` append-only table.
  `archive_object_kind` enum gains `PDF_FINAL`.
- **Thresholds** — `lib/shaam/thresholds.ts` encodes the ITA tier
  schedule (2024→2025→2026-01→2026-06) and a
  `SHAAM_THRESHOLD_OVERRIDE` for UAT.
- **Payload builder** — `lib/shaam/payload.ts` produces v2.0 JSON
  with all required fields, deterministic, credit-note reference
  block when a credit references an original.
- **HTTP layer** — `submitInvoice` in `lib/shaam/client.ts` POSTs
  with Idempotency-Key + X-Correlation-Id, 15s timeout, three
  outcomes (APPROVED / REJECTED / HELD) plus TIMEOUT and
  NETWORK_ERROR. `_setShaamFetchForTests` swaps the fetch impl for
  the verify harness.
- **Orchestrator** — `lib/shaam/submit.ts` runs threshold check →
  idempotency check → token → payload → HTTP → DB updates +
  SHAAM_SUBMITTED / SHAAM_ALLOCATION_RECEIVED / SHAAM_REJECTED
  audit events. Advisory-locked per-document so concurrent retries
  collapse.
- **Wiring** — `issueOutboundInvoice` and `issueCreditNote` call
  `submitDocumentToShaam` outside their transaction. On APPROVED,
  they re-render the PDF with the allocation number and archive as
  `PDF_FINAL`. Archive/render failures are non-fatal.
- **Cron** — `/api/cron/shaam-retry-pending` every 15 minutes, with
  exponential backoff per retry count (max 10).
- **Admin UI** — `/admin/shaam/submissions` lists all submissions
  with filters + full request/response JSON expander. Invoice
  detail page shows a `ShaamStatusPanel` with state-specific
  actions (retry, accept rejection, offer reverse charge).
- **PDF** — allocation number rendered next to the invoice number
  with the rightmost 9 digits visually emphasised.
- **i18n** — `shaamSubmission.*` strings in both en + he.
- **Typed errors** — `ShaamAuthorizationError` surfaces from
  `submitInvoice` on 401 so the orchestrator can flip the invoice
  to PENDING and the token lifecycle to EXPIRED.

## Known open questions (pre-UAT testing)

Open questions, to confirm against the ITA portal:

- Confirm the clearance endpoint path matches the ITA portal's
  `SHAAM_INVOICE_PATH` default (`/clearance/invoices`).
- Confirm invoice-type numeric codes (305 / 320 / 400 / 330 / 100 /
  710) against the live v2.0 spec.
- Confirm VAT rate string format (`"18"` vs `"18.0"` vs `"0.18"`).
- Subcategory codes default to heuristic mapping pending Spec 11's
  per-line category column.

## Verification scripts after Spec 08

- `verify-numbering.ts` — 6/6 (unchanged).
- `verify-audit.ts` — 5/5 (unchanged).
- `verify-rbac.ts` — 7/7 (unchanged).
- `verify-signing.ts` — 7/7 (unchanged).
- `verify-archive.ts` — 5/5 when S3 reachable (unchanged).
- `verify-credit-notes.ts` — 9/9 (unchanged).
- `verify-shaam-oauth.ts` — 10/10 (fetch stubbed; unchanged).
- `verify-shaam-submission.ts` — **new**. 11 pure / mocked scenarios
  (thresholds, payload determinism, idempotency key, APPROVED /
  REJECTED / HELD / TIMEOUT, regex allocation extraction, 401,
  credit-note reference block, money basics).
