-- Spec 08+ — Pattern C and "queue-and-auto-send" support.
--
-- 1. `pdf_kind` distinguishes the two flavors of stored PDF:
--      - `interim`: rendered without a SHAAM allocation number (only
--        possible for above-threshold docs whose SHAAM submission is
--        still PENDING / OUTAGE_ISSUED).
--      - `final`:   either no allocation was required (NOT_REQUIRED /
--        NOT_APPLICABLE) or SHAAM has approved and the helper
--        `regenerateAndArchiveFinalPdf` has re-rendered + re-archived.
--    Defaults to `interim` so any pre-existing row that hasn't been
--    re-archived is treated as interim until the next cron pass; the
--    helper flips it to `final` after a successful APPROVED clear.
--
-- 2. `queued_delivery_*` capture the email-send parameters when the
--    seller chooses "queue and send when SHAAM clears" instead of
--    "send anyway (force)". The retry cron checks these columns on
--    APPROVED, fires the send, then atomically clears the columns.

ALTER TABLE "outbound_invoices"
  ADD COLUMN "pdf_kind" text NOT NULL DEFAULT 'interim',
  ADD COLUMN "queued_delivery_recipient" text,
  ADD COLUMN "queued_delivery_subject" text,
  ADD COLUMN "queued_delivery_body_text" text,
  ADD COLUMN "queued_delivery_queued_at" timestamptz,
  ADD COLUMN "queued_delivery_queued_by" uuid
    REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "outbound_invoices"
  ADD CONSTRAINT "outbound_invoices_pdf_kind_check"
  CHECK ("pdf_kind" IN ('interim', 'final'));

-- Already-issued rows whose SHAAM didn't require allocation are final.
-- Already-APPROVED rows MAY still be interim if archivePdfFinal hadn't
-- been re-run by the cron yet (the bug this migration is part of fixing);
-- leave those at the default and let the cron promote them on the next
-- cycle, which keeps the post-deploy invariant honest.
UPDATE "outbound_invoices"
SET "pdf_kind" = 'final'
WHERE "shaam_status" IN ('NOT_APPLICABLE', 'NOT_REQUIRED');
