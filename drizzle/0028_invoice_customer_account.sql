-- Per-invoice Hashavshevet customer GL (vendors may map to multiple GL codes).
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "customer_account_number" varchar(20);
