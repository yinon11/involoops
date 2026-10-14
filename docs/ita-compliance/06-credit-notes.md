# Spec 06 — Credit Notes (חשבונית זיכוי)

Archive copy. Canonical source: conversation transcript.

## Summary

Credit notes are the ONLY lawful correction path for issued tax
invoices under Israeli bookkeeping rules. Each is a full standalone
document with its own sequence number, signature, PDF, archive set,
and audit chain. It links back to the original via two complementary
mechanisms:

- Denormalised `outbound_invoices.references_document_id` for fast
  display.
- Canonical `document_links` row keyed on `(from_document_id,
  to_document_id, link_type)` with `CREDIT_REVERSES` for full
  credits and `CREDIT_PARTIAL` for partial.

## Flow

`src/actions/credit-note-actions.ts → issueCreditNote`:

1. RBAC (`DOCUMENT_VOID`) + session.
2. `db.transaction` wraps everything:
   - `SELECT ... FOR UPDATE` on the original row (serialises
     concurrent credits against the same original; no over-credit race).
   - `validateCreditNoteRequest` (pure) enforces document type,
     status, cross-tenant, amount > 0, amount ≤ remaining, reason ≥ 10
     chars.
   - `allocateDocumentNumberTx` under `CREDIT_INVOICE` for the
     current tax year.
   - Insert credit-note row (status `draft`, negative totals).
   - Insert `document_links` row.
   - Emit `CREATED` audit entry on the credit note.
   - Build canonical JSON with `reference` block
     (documentId, formattedNumber, issueDate, grandTotal,
     canonicalJsonHash of the original's signed snapshot).
   - Sign in memory (RSA/SHA-256).
   - `persistSignatureTx` → flip to `issued` + emit `SIGNED`.
   - Render PDF via puppeteer (in memory).
   - `archiveDocument` — uploads 4 COMPLIANCE-locked S3 objects,
     inserts archive index rows, emits `ARCHIVED`.
   - Decrement original's `net_of_credits_amount`. If it reaches 0,
     flip original to `voided` and emit `VOIDED` on the original.
   - Emit `CREDIT_NOTE_ISSUED` on the ORIGINAL with
     `{ creditNoteId, amount, reason, isFullCredit, remainingAfter }`.

A failure anywhere rolls everything back: S3 puts inside
`archiveDocument` fail before any archive-index row is written; the
outer tx rolls back every DB write (credit draft, link, sequence
allocation, signature, status flips, audit events).

## UI

- `/outbound/[id]/credit` — credit-note issuance form (admin-only).
  Shows original ref, remaining balance, credit-amount input
  (default full remaining), reason textarea (min 10 chars), confirm
  dialog.
- Detail page:
  - Credit notes show a red `CreditNoteBanner` above the viewer.
  - Tax invoices with balance show "Issue Credit Note" button.
  - Tax invoices show `CreditHistoryCard` listing linked credits and
    remaining balance.
- PDF renders "חשבונית זיכוי" banner + "בגין חשבונית {X} מתאריך {Y}".

## Money math

Credit-note accounting lives in `src/lib/money.ts` as string-based
cent arithmetic (`addMoney`, `subtractMoney`, `compareMoney`,
`negateMoney`). Never uses JS floats.

## Verification scripts (post-spec 06)

- `verify-numbering.ts` — 6/6 (unchanged).
- `verify-audit.ts` — 5/5 (unchanged).
- `verify-rbac.ts` — 7/7 (unchanged).
- `verify-signing.ts` — 7/7 (unchanged).
- `verify-archive.ts` — 5/5 when S3 reachable (unchanged).
- `verify-credit-notes.ts` — new; 7 scenarios (full credit, partial
  credit, sequential partials, over-credit prevention, credit-on-draft
  rejected, credit-on-credit rejected, validation rules on amount
  and reason).
