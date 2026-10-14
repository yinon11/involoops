-- Per-customer daily cap on outbound document issuance.
--
-- Two additions:
--
--   1. `users.max_outbound_invoices_per_customer_per_day` — nullable
--      per-account override. NULL (the default for every existing account)
--      means "use the product default", which lives in code as
--      DEFAULT_MAX_OUTBOUND_DOCS_PER_CUSTOMER_PER_DAY. Keeping the fallback
--      out of the column default means raising the product-wide limit needs
--      no migration and no backfill of rows that never opted out.
--
--   2. `outbound_invoices.issued_at` — stamped in the same transaction that
--      allocates the fiscal number. The cap counts this column, so it must
--      exist for documents issued BEFORE this migration too; backfilled from
--      document_signatures.signed_at below.
--
-- See src/lib/outbound/customer-daily-limit.ts.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "max_outbound_invoices_per_customer_per_day" integer;--> statement-breakpoint
ALTER TABLE "outbound_invoices" ADD COLUMN IF NOT EXISTS "issued_at" timestamp with time zone;--> statement-breakpoint

-- Backfill: one signature row per issued document, so signed_at is the best
-- available record of when each existing document was issued. Rows with no
-- signature (drafts, and documents whose issue attempt died before archive)
-- correctly stay NULL and therefore never count against the cap.
UPDATE "outbound_invoices" AS oi
SET "issued_at" = ds."signed_at"
FROM "document_signatures" AS ds
WHERE ds."document_id" = oi."id"
  AND oi."issued_at" IS NULL;--> statement-breakpoint

-- Backs the cap's COUNT (customer_id, issued_at). Partial: only issued rows
-- are ever counted, and drafts are the bulk of the table for active accounts.
CREATE INDEX IF NOT EXISTS "outbound_invoices_customer_issued_at_idx" ON "outbound_invoices" USING btree ("customer_id","issued_at") WHERE "issued_at" IS NOT NULL;
