-- `UNRESOLVED` — the reconciliation cron gave up, which is not the same
-- thing as רשות המסים refusing the invoice.
--
-- Exhausted retries used to be written as REJECTED, so the UI told the
-- seller "נדחה על ידי רשות המסים" when in fact nobody at the Tax Authority
-- had looked at the document: we simply stopped asking. The remedy is
-- different too — a refusal needs one of the statutory options, an
-- unresolved document just needs another attempt.
--
-- `shaam_status` is a plain text column (the allowed set is enforced in
-- TypeScript), so the new state needs no DDL. This migration backfills the
-- rows that were mislabelled.

UPDATE "outbound_invoices"
SET "shaam_status" = 'UNRESOLVED'
WHERE "shaam_status" = 'REJECTED'
  AND "shaam_last_error_code" = 'max_retries_exceeded';
