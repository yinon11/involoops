-- Enrich income imports for Hashavshevet MOVEIN (customer GL + payment splits).
ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "external_account_number" varchar(20);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "import_payments" jsonb;
