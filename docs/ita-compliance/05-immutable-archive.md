# Spec 05 — Immutable Archive (7-Year Retention)

Archive copy. Canonical source: conversation transcript.

## Summary

Every issued document writes four tamper-evident objects to a dedicated
COMPLIANCE-mode Object-Locked S3/MinIO bucket:

- `CANONICAL_JSON` — the exact bytes the signature was computed over.
- `SIGNATURE` — stable JSON {keyId, algorithm, signatureBase64, signedAt,
  canonicalJsonHash}.
- `PDF` — the issued-state rendered PDF.
- `AUDIT_BUNDLE` — every audit entry for the document up to the archive
  moment.

The index lives in Postgres `archive_objects` with a
per-business-entity SHA-256 hash chain (`chain_sequence`,
`chain_entry_hash`, `chain_previous_hash`). S3 writes happen before the
DB transaction — if S3 fails, nothing is committed; if DB commit fails
afterwards, the S3 objects are orphans that the reconcile script lists.

## New code

- `src/db/schema/archive-objects.ts` + `archive_object_kind` enum.
- `src/lib/archive/{keys,s3,hash-chain,store,verify,retrieve}.ts`.
- `src/actions/archive-actions.ts` — admin list + verify + download.
- `src/app/(app)/admin/archive/page.tsx` + three client components.
- `src/app/api/cron/verify-archive-chains/route.ts`,
  `src/app/api/cron/verify-archive-locks/route.ts`.
- Scripts: `setup-archive-bucket`, `find-archive-orphans`,
  `verify-archive`.
- Migration `drizzle/0026_archive_objects.sql`.

## Issue flow (post-spec-05)

1. RBAC guard + draft-status guard.
2. `computeSignatureForDraft` — build canonical JSON + sign (memory).
3. `generateInvoicePdf` — puppeteer render to Buffer.
4. `archiveDocument` uploads four Object-Locked S3 objects.
5. DB transaction:
   - `persistSignatureTx` — inserts `document_signatures`, flips
     `outbound_invoices.status` to `issued`, emits `SIGNED`.
   - `archiveDocument` second half — inserts four `archive_objects`
     rows with the per-business-entity hash chain, emits `ARCHIVED`.

## Bootstrapping a new environment

```
# 1) Apply migration 0026 (create table + enum).
# 2) Provision the bucket:
npx tsx scripts/setup-archive-bucket.ts
#    Expect: ObjectLockEnabled=true mode=COMPLIANCE days=2557
# 3) Schedule the two cron routes (see KNOWN_ISSUES).
```

## Verification scripts

- `verify-numbering.ts` — 6/6 (unchanged).
- `verify-audit.ts` — 5/5 (unchanged).
- `verify-rbac.ts` — 7/7 (unchanged).
- `verify-signing.ts` — 7/7 (unchanged; uses back-compat `signDocument`
  wrapper added alongside `computeSignatureForDraft` +
  `persistSignatureTx`).
- `verify-archive.ts` — 5/5 when S3 is reachable. Scenarios gracefully
  SKIP when the archive bucket isn't reachable so the script is safe
  to run locally without MinIO.
