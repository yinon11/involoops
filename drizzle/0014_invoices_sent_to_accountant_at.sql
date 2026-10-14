-- Tracks when the user marked an inbound invoice as sent to their accountant.
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "sent_to_accountant_at" timestamp;
