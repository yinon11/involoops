# Spec 01 — Document Numbering

> **Context:** Read `AGENTS.md` at the repo root first. This spec extends the existing outbound invoicing area (`src/app/(app)/outbound/`). It is the foundation for all subsequent compliance work.
>
> **Access control:** All features in this spec are gated to platform admins (`isUserAdmin(session.user.id)`) at the UI and nav level. Data and server actions must be scoped by `session.user.id` so the eventual rollout to all tenants requires no refactor.

## Goal

Implement gapless, strictly sequential document numbering per business entity, per document type, with concurrency-safe allocation at the database level. This is mandatory under Israeli Income Tax Ordinance (Bookkeeping Rules), 1973.

## Background

The Israeli Tax Authority requires that every document issued by accounting software satisfy:

1. **Sequential numbering** — each document gets the next integer in a running sequence
2. **No gaps** — if a document is allocated a number and never issued, the sequence is violated
3. **Separate sequences per document type** — tax invoices, tax invoice-receipts, receipts, credit invoices, proforma invoices each have their own running counter
4. **Scoped to the issuing business entity** — each Osek Murshe has independent sequences, not shared globally
5. **Auditable year boundaries** — sequences typically reset or track per tax year (configurable by the business)

**Current state in InvoLoops:** `outbound-invoice-actions.ts` has a `nextNumber()` helper that is insufficient for compliance — it likely scans and increments without database-level locking, and doesn't distinguish document types.

## Required changes

### 1. Drizzle schema

Add a new table `document_number_sequences` in `src/db/schema/` (create a new file `document-number-sequences.ts` and export it from `src/db/schema/index.ts`):

```ts
// Columns (exact types to match existing Drizzle patterns):
// - id: uuid primary key, default random
// - userId: text/uuid, foreign key to users.id, NOT NULL, indexed
// - documentType: enum — 'TAX_INVOICE' | 'TAX_INVOICE_RECEIPT' | 'RECEIPT' | 'CREDIT_INVOICE' | 'PROFORMA' | 'DELIVERY_NOTE'
// - taxYear: integer, NOT NULL (e.g. 2026)
// - currentNumber: bigint, NOT NULL, default 0
// - createdAt: timestamp, NOT NULL, default now()
// - updatedAt: timestamp, NOT NULL, default now()
// - UNIQUE constraint on (userId, documentType, taxYear)
```

Also create a Postgres enum `document_type` for the `documentType` column. Define it once in Drizzle and reuse it across future tables.

### 2. Modify `outbound_invoices` table

In the existing `outbound_invoices` schema:

- Add column `documentType document_type NOT NULL DEFAULT 'TAX_INVOICE'`
- Add column `taxYear integer NOT NULL` (populate from issue date)
- Add column `sequenceNumber bigint NOT NULL`
- Add column `formattedNumber text NOT NULL` (e.g. `"2026-TI-000123"` — human-readable display)
- Add UNIQUE constraint on `(userId, documentType, taxYear, sequenceNumber)`
- The existing `number` column, if any, should be kept for backward compat but deprecated; new code uses `formattedNumber` for display and `sequenceNumber` for ordering.

Provide a migration script that backfills existing `outbound_invoices` rows:
- `documentType = 'TAX_INVOICE'` for all existing rows
- `taxYear` derived from existing issue date
- `sequenceNumber` assigned by issuance date ordering, per user
- `formattedNumber` computed from the pattern below

### 3. Numbering format

Format strings (stored in `formattedNumber` and shown in UI):

- `TAX_INVOICE` → `{taxYear}-TI-{seq:06d}` (e.g. `2026-TI-000001`)
- `TAX_INVOICE_RECEIPT` → `{taxYear}-TIR-{seq:06d}`
- `RECEIPT` → `{taxYear}-RC-{seq:06d}`
- `CREDIT_INVOICE` → `{taxYear}-CI-{seq:06d}`
- `PROFORMA` → `{taxYear}-PF-{seq:06d}` (informational only; never submitted to SHAAM)
- `DELIVERY_NOTE` → `{taxYear}-DN-{seq:06d}`

The format must be a pure function of `(documentType, taxYear, sequenceNumber)`. Centralize in `src/lib/documents/format-number.ts`.

### 4. Allocation server action

Create `src/actions/document-number-actions.ts` with:

```ts
"use server";

export async function allocateDocumentNumber(params: {
  documentType: DocumentType;
  taxYear: number;
}): Promise<{
  sequenceNumber: number;
  formattedNumber: string;
  documentType: DocumentType;
  taxYear: number;
}>;
```

**Implementation requirements:**

- Must use a Postgres transaction with `SELECT ... FOR UPDATE` on the row in `document_number_sequences`, or equivalent advisory-lock pattern, to prevent race conditions under concurrent allocation.
- If no row exists for `(userId, documentType, taxYear)`, create one with `currentNumber = 1` and return `1`. Otherwise `UPDATE ... SET currentNumber = currentNumber + 1 RETURNING currentNumber`.
- **Do not allocate a number unless the caller commits to using it.** Pattern: the transaction that allocates the number must also insert the `outbound_invoices` row in the same transaction. See next section.

### 5. Invoice creation refactor

In `src/actions/outbound-invoice-actions.ts`, modify `createOutboundInvoice` (or whatever the creation action is named):

- Wrap the entire create flow in a single DB transaction.
- Inside the transaction: call the number-allocation logic, then insert the `outbound_invoices` row with that number. Both succeed or both fail.
- Remove any pre-existing "get next number" API that returns a number without committing — this invites gap-creating bugs.
- The `outbound/new/page.tsx` "preview next number" display must be relabeled to something like "next available number (subject to allocation at save)" in the UI, and must not reserve a number.

### 6. UI updates

- `outbound/page.tsx` (list): show `formattedNumber` instead of raw number; show `documentType` badge.
- `outbound/[id]/page.tsx` (detail): same.
- `create-invoice-form.tsx`: add a document type selector (default `TAX_INVOICE`). Default other types are not yet supported by the creation UI; put them behind a feature flag or only accept `TAX_INVOICE` for now with a TODO comment referencing future specs 06 (credit notes) and 08 (SHAAM).

### 7. Year rollover behavior

At January 1 of each new tax year, the first document of that type in that year starts at `1`. The `taxYear` column on both tables makes this automatic — no cron job needed. A business that issues its first 2027 invoice in March 2027 gets sequence number `1`.

### 8. Hebrew i18n strings

Add to `src/lib/i18n/dictionaries/he.{ts|json}` and `en.{ts|json}`:

```
documents.type.TAX_INVOICE: "חשבונית מס" / "Tax Invoice"
documents.type.TAX_INVOICE_RECEIPT: "חשבונית מס קבלה" / "Tax Invoice Receipt"
documents.type.RECEIPT: "קבלה" / "Receipt"
documents.type.CREDIT_INVOICE: "חשבונית זיכוי" / "Credit Invoice"
documents.type.PROFORMA: "חשבונית פרופורמה" / "Proforma Invoice"
documents.type.DELIVERY_NOTE: "תעודת משלוח" / "Delivery Note"
documents.numbering.nextAvailable: "מספר זמין הבא" / "Next available number"
documents.numbering.allocated: "מספר שהוקצה" / "Allocated number"
```

## Tests

Add tests under the project's existing test location (or `src/__tests__/documents/` if none exists):

1. **Concurrency test** — fire 10 parallel `allocateDocumentNumber` calls for the same user/type/year; assert they receive exactly `1..10` with no duplicates and no gaps.
2. **Gap prevention test** — attempt to create an invoice that will fail mid-transaction (e.g. invalid customer reference); assert no sequence number was consumed.
3. **Separation test** — create one tax invoice for user A and one for user B; assert both have `sequenceNumber = 1`.
4. **Type separation test** — create one tax invoice and one receipt for user A; assert both have `sequenceNumber = 1`.
5. **Year rollover test** — mock the current date to January 1 of a new year; create an invoice; assert `sequenceNumber = 1` and `taxYear` is the new year.
6. **Format test** — given `(TAX_INVOICE, 2026, 42)` assert output `"2026-TI-000042"`.

If the repo lacks a test runner, skip writing tests but add a comment at the top of `document-number-actions.ts` listing the scenarios above as TODO, and implement a manual verification script under `scripts/verify-numbering.ts` that exercises scenario 1 and prints results.

## Files to create or modify

**New:**
- `src/db/schema/document-number-sequences.ts`
- `src/actions/document-number-actions.ts`
- `src/lib/documents/format-number.ts`
- `src/lib/documents/types.ts` (export `DocumentType` enum as a TypeScript type mirroring the Drizzle enum)
- `drizzle/<new-migration>.sql` (generated via `npx drizzle-kit generate`)
- Tests or `scripts/verify-numbering.ts`

**Modify:**
- `src/db/schema/index.ts` (export new schema)
- `src/db/schema/<outbound-invoices-file>.ts` (add columns, constraint)
- `src/actions/outbound-invoice-actions.ts` (refactor create to use transaction + allocation)
- `src/app/(app)/outbound/page.tsx`
- `src/app/(app)/outbound/new/page.tsx`
- `src/app/(app)/outbound/[id]/page.tsx`
- `src/components/outbound/create-invoice-form.tsx`
- `src/components/outbound/invoice-view-client.tsx`
- `src/lib/i18n/dictionaries/he.*`, `en.*`

## Done criteria

- [ ] New schema and migration applied; existing data backfilled correctly.
- [ ] `allocateDocumentNumber` is concurrency-safe (verified by test or manual script).
- [ ] Creating an outbound invoice allocates a number atomically — no gaps possible.
- [ ] UI displays `formattedNumber` correctly in list and detail views.
- [ ] Hebrew and English labels work in both locales.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] Manual smoke test: create 3 invoices, delete one in DB, confirm the sequence visibly has a gap (this is correct — deletes should be rare; real voids use credit notes from spec 06; we just want to see the numbers are real sequence numbers, not recomputed on display).
- [ ] Platform admin gating preserved: non-admin users cannot reach any outbound route.
- [ ] No cross-tenant data leakage: user A never sees user B's invoices or sequences.

## Explicit non-goals for this spec

- Digital signatures — spec 04
- Audit log of allocations — spec 02 (will reference this spec)
- SHAAM allocation numbers — spec 08
- Credit note linkage — spec 06

## Open questions to raise if encountered

If during implementation Claude Code finds that:

- The existing `outbound_invoices` "number" column is not a simple integer, stop and ask before migrating.
- The existing numbering is *per template* rather than *per user*, stop and ask. The compliance model is per user (business entity), not per template.
- Drizzle transactions don't support `SELECT ... FOR UPDATE` in this project's setup, report back with what is available (advisory locks, serializable isolation, etc.).

---

**End of spec 01.** When done, report:
1. Files created/modified
2. Any deviations from spec and reasoning
3. Any open questions that surfaced
