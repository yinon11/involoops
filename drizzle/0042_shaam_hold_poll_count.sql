-- Reconciliation of held documents.
--
-- `/api/cron/shaam-retry-pending` used to scan only PENDING and
-- OUTAGE_ISSUED, so a document the ITA reported as HELD ("not decided
-- yet") was never asked about again — an approval arriving a day later
-- went unnoticed until someone pressed retry by hand.
--
-- Holds are now polled on their own slow ladder, paced by this counter.
-- It is deliberately NOT `shaam_retry_count`: that one counts failed
-- delivery attempts and retires the document at MAX_RETRIES, which is the
-- wrong verdict for a hold where nothing actually failed.

ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "shaam_hold_poll_count" integer DEFAULT 0 NOT NULL;
