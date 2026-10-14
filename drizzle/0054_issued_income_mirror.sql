-- A document this business issued also appears in the invoices list as
-- approved income. The issued row stays the source of truth; this link
-- is how the list copy is kept in step with it.
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "outbound_invoice_id" uuid;

DO $$ BEGIN
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_outbound_invoice_id_outbound_invoices_id_fk"
    FOREIGN KEY ("outbound_invoice_id")
    REFERENCES "outbound_invoices"("id")
    ON DELETE CASCADE
    ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_outbound_invoice_id_unique"
  ON "invoices" ("outbound_invoice_id");
