# Spec 02 — Immutable Audit Log

> **Context:** Read `AGENTS.md` at the repo root first. Read `compliance/01-document-numbering.md` — this spec assumes the new numbering model is in place.
>
> **Access control:** All features in this spec are gated to platform admins (`isUserAdmin(session.user.id)`) at the UI and nav level. Data and server actions must be scoped by `session.user.id` so the eventual rollout to all tenants requires no refactor.

## Goal

Implement an append-only audit log that records every lifecycle event on outbound invoice documents. This log is a regulatory requirement under Israeli Income Tax Ordinance (Bookkeeping Rules), 1973, and is required evidence in the Form 513 submission package.

## Background

The ITA requires that accounting software maintain a full, tamper-evident history of every document operation. The software registry inspectors can request audit log exports at any time. Under ISRAELI bookkeeping rules:

1. Every meaningful action on a document (create, update, void, sign, archive, submit to SHAAM, receive allocation number) must be logged
2. Log entries must be append-only — no updates, no deletes
3. Log must be retained for at least 7 years
4. Log must be linkable to a specific user, specific document, specific timestamp
5. Chain of custody must be verifiable — ideally a hash chain so tampering is detectable

**Current state:** No audit logging exists for outbound invoicing. `outbound-invoice-actions.ts` mutates rows directly without trail.

## Required changes

### 1. Drizzle schema

Create `src/db/schema/document-audit-log.ts`:

```ts
// Table: document_audit_log
// Columns:
// - id: uuid primary key, default random
// - userId: text/uuid, foreign key to users.id, NOT NULL, indexed
// - documentId: uuid, NOT NULL, indexed (references outbound_invoices.id but no FK — we must retain audit entries even if the document is deleted, though deletion should be blocked elsewhere)
// - documentType: document_type enum (reuse from spec 01)
// - eventType: enum 'CREATED' | 'UPDATED' | 'STATUS_CHANGED' | 'VOIDED' | 'SIGNED' | 'ARCHIVED' | 'SHAAM_SUBMITTED' | 'SHAAM_ALLOCATION_RECEIVED' | 'SHAAM_REJECTED' | 'PDF_GENERATED' | 'VIEWED' | 'EXPORTED' | 'CREDIT_NOTE_ISSUED'
// - eventPayload: jsonb, NOT NULL — structured data about the event
// - actorUserId: text/uuid, NOT NULL — the session user who performed the action (may differ from userId if an admin acts on another tenant's behalf in future)
// - actorIp: text, nullable — request IP if available
// - actorUserAgent: text, nullable
// - previousHash: text, nullable — hex-encoded SHA-256 of the immediately previous entry for this userId (hash chain, see section 3)
// - entryHash: text, NOT NULL — hex-encoded SHA-256 of this entry's canonical representation + previousHash
// - sequenceNumber: bigint, NOT NULL — per-user monotonically increasing integer, allocated via the same FOR UPDATE pattern as doc 01
// - createdAt: timestamp with time zone, NOT NULL, default now()
// Indexes:
// - (userId, createdAt DESC) for timeline queries
// - (documentId) for per-document history
// - UNIQUE (userId, sequenceNumber) — one hash chain per user
```

Register the Postgres enum `audit_event_type`.

### 2. Append-only enforcement

The table is logically append-only. Enforce via:

1. No UPDATE or DELETE server action exists for this table. Ever.
2. Postgres-level revoke of UPDATE/DELETE privileges on this table for the application role (provide a SQL migration that does this). If the existing DB user is a superuser, document this as a known limitation and add it to the Form 513 submission package's security caveats.
3. A runtime check in the DB layer: attempting to call `.update()` or `.delete()` on this table from Drizzle throws. Centralize audit writes in a single module `src/lib/audit/append.ts`.

### 3. Hash chain

Every entry's `entryHash` is computed as:

```
SHA-256(
  canonical_json({
    userId,
    documentId,
    documentType,
    eventType,
    eventPayload,
    actorUserId,
    actorIp,
    actorUserAgent,
    sequenceNumber,
    createdAt: <ISO-8601 UTC with ms precision>,
    previousHash: <hex or empty string if first entry>
  })
)
```

Canonical JSON: keys sorted alphabetically, no whitespace, UTF-8, no trailing newline. Implement this in `src/lib/audit/canonical-json.ts` (pure function, reusable by spec 04).

First entry for a user: `previousHash` is empty string, and `sequenceNumber` is 1.

Each subsequent entry: `previousHash` is the `entryHash` of the entry with `sequenceNumber = current - 1` for this user.

The allocation of `sequenceNumber` and the read of the previous `entryHash` must both happen inside a single transaction that holds a row lock on the most recent entry for that user. Concurrent appends must serialize.

Provide a verification function `verifyChain(userId): { ok: boolean; brokenAt?: number }` that walks the chain from 1 to N and recomputes each hash. Call this from a manual admin endpoint (no automated schedule yet; spec 05 adds periodic verification).

### 4. Append helper

Create `src/lib/audit/append.ts`:

```ts
export async function appendAuditEntry(params: {
  userId: string;
  documentId: string;
  documentType: DocumentType;
  eventType: AuditEventType;
  eventPayload: Record<string, unknown>;
  actor: {
    userId: string;
    ip?: string;
    userAgent?: string;
  };
  tx?: DrizzleTransaction; // optional: caller can pass an outer transaction
}): Promise<{ sequenceNumber: number; entryHash: string }>;
```

If `tx` is provided, append participates in the outer transaction. Otherwise, a new transaction is opened. This lets callers like "create invoice" atomically combine number allocation + row insert + audit entry.

### 5. Wire audit events into existing flows

Modify `src/actions/outbound-invoice-actions.ts`:

- **Create:** emit `CREATED` with payload `{ sequenceNumber, formattedNumber, documentType, customerId, totalAmount, currency, taxYear }`
- **Update (while draft):** emit `UPDATED` with payload `{ changedFields: {...oldToNew}, version: number }`. Maintain a `version` integer on `outbound_invoices` incremented on each update.
- **Status change:** emit `STATUS_CHANGED` with payload `{ from, to }`
- **Void (see spec 06 for credit note flow):** emit `VOIDED` — but for now, blocked; document a TODO
- **Delete:** block deletes outright for any document past `draft` status. For `draft` status, deletes are allowed but must emit `VOIDED` (not a raw delete) and keep the row with a `deletedAt` tombstone. Add `deletedAt` column to `outbound_invoices`. Never physically remove rows.
- **PDF generation** (`src/app/api/invoice-pdf/route.ts` + `src/lib/pdf/generate-pdf.ts`): emit `PDF_GENERATED` with payload `{ pdfUrl, hash }` — compute SHA-256 of PDF bytes before upload and include it.
- **View** in detail page: optional, commented-out. Viewing does not need to be logged for Form 513 compliance. Leave the event type in the enum for future use.

### 6. Admin UI for audit log

Create `src/app/(app)/admin/audit/page.tsx`:

- Admin-only (reuse existing admin gating).
- Lists recent audit entries across all users (admin view), paginated, most recent first.
- Filters: by `userId`, by `documentId`, by `eventType`, by date range.
- Shows: timestamp, user email, actor email, event type, document type, formatted number, payload preview, `sequenceNumber`, truncated `entryHash`.
- A button "Verify chain" per user that runs `verifyChain(userId)` and shows result.
- An export button that downloads the current filtered view as JSON.

Nav: add "Audit Log" under admin nav (next to "Outbound" and "Users"), visible only to admins.

### 7. Per-document timeline

On `src/app/(app)/outbound/[id]/page.tsx` detail page, add a collapsible "History" section that shows this document's audit timeline (all events with `documentId = this.id`), reverse chronological. Admin-only for now; will be shown to tenants in the future.

### 8. Hebrew i18n

Add to both locales:
```
audit.event.CREATED: "נוצר" / "Created"
audit.event.UPDATED: "עודכן" / "Updated"
audit.event.STATUS_CHANGED: "סטטוס שונה" / "Status changed"
audit.event.VOIDED: "בוטל" / "Voided"
audit.event.SIGNED: "נחתם דיגיטלית" / "Digitally signed"
audit.event.ARCHIVED: "הועבר לארכיון" / "Archived"
audit.event.SHAAM_SUBMITTED: "הוגש לרשות המסים" / "Submitted to ITA"
audit.event.SHAAM_ALLOCATION_RECEIVED: "התקבל מספר הקצאה" / "Allocation number received"
audit.event.SHAAM_REJECTED: "נדחה על ידי רשות המסים" / "Rejected by ITA"
audit.event.PDF_GENERATED: "הופק PDF" / "PDF generated"
audit.event.CREDIT_NOTE_ISSUED: "הונפקה חשבונית זיכוי" / "Credit note issued"
audit.chain.verified: "שרשרת הגיבוי תקינה" / "Audit chain verified"
audit.chain.broken: "שרשרת הגיבוי פגומה בערך מספר {n}" / "Audit chain broken at entry {n}"
```

## Tests

1. **Chain integrity** — append 100 entries for a single user; `verifyChain` returns `ok: true`.
2. **Chain tampering** — append 10 entries; manually update the payload of entry 5 in the DB; `verifyChain` returns `ok: false, brokenAt: 5`.
3. **Concurrency** — fire 20 parallel appends for the same user; all succeed, sequence numbers are exactly 1..20, no duplicates, chain validates.
4. **Separation** — appends for user A and user B don't interfere; each has independent chain.
5. **Transaction rollback** — open a transaction, append an entry, roll back; assert nothing was written and the next entry for that user has the expected sequence number (i.e., the rolled-back append left no trace).
6. **Update/delete blocked** — attempt UPDATE or DELETE directly against `document_audit_log`; expect failure (or documented caveat if DB role is superuser).

If no test runner, write a `scripts/verify-audit.ts` that exercises scenarios 1, 2, 3, 5.

## Files to create or modify

**New:**
- `src/db/schema/document-audit-log.ts`
- `src/lib/audit/canonical-json.ts`
- `src/lib/audit/append.ts`
- `src/lib/audit/verify-chain.ts`
- `src/app/(app)/admin/audit/page.tsx`
- `src/actions/audit-actions.ts` (admin-only list/filter/export server actions)
- `drizzle/<new-migration>.sql`
- Tests or `scripts/verify-audit.ts`

**Modify:**
- `src/db/schema/index.ts`
- `src/db/schema/<outbound-invoices-file>.ts` (add `version`, `deletedAt`)
- `src/actions/outbound-invoice-actions.ts` (add audit calls to every mutating action, enforce no physical deletes)
- `src/app/api/invoice-pdf/route.ts` (emit `PDF_GENERATED`)
- `src/lib/pdf/generate-pdf.ts` (compute + return PDF SHA-256)
- `src/app/(app)/outbound/[id]/page.tsx` (add history section)
- `src/app/(app)/layout.tsx` or wherever admin nav lives (add "Audit Log" link)
- `src/lib/i18n/dictionaries/he.*`, `en.*`

## Done criteria

- [ ] New `document_audit_log` table and enum created and migrated.
- [ ] `appendAuditEntry` is concurrency-safe and produces a valid hash chain.
- [ ] Every existing mutating flow in outbound invoicing emits an audit event.
- [ ] No code path deletes rows from `outbound_invoices` except soft-delete of drafts.
- [ ] No code path updates or deletes rows in `document_audit_log`.
- [ ] Admin audit page renders, filters work, export works.
- [ ] Per-document history renders on detail page.
- [ ] Verify chain function works and reports breaks correctly.
- [ ] Hebrew and English labels render in both locales.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] Manual smoke test: create, edit, change status, generate PDF of one invoice; open admin audit page; see all 4 events with a valid chain.

## Explicit non-goals for this spec

- Digital signature of the document itself — spec 04 (though PDF hash is captured now)
- Archive storage of document versions — spec 05
- Periodic automated chain verification — spec 05
- RBAC around who can export the audit log — spec 03

## Open questions to raise if encountered

- If the project's DB user has unrestricted privileges and Postgres-level REVOKE is not feasible, note this clearly in the implementation and add a comment at the top of `document-audit-log.ts` explaining that append-only is enforced at the application layer only. Spec 12 will reference this caveat.
- If Drizzle cannot reliably pass a transaction into `appendAuditEntry` in the existing project style, propose the idiomatic pattern (e.g. a callback-based `withTransaction`) and implement that, updating other specs' dependencies accordingly.
- If PDF generation is async (queue-based), decide whether `PDF_GENERATED` emits at enqueue or at completion. Default: at completion.

---

**End of spec 02.** When done, report:
1. Files created/modified
2. Any deviations from spec and reasoning
3. Any open questions that surfaced
4. Confirmation that the append-only and hash chain invariants are enforced
