-- Reverse charge after an ITA refusal (route B) issues a NEW invoice.
--
-- ITA v2.0 spec §2.2.2: "A zero-rate invoice will receive a reference
-- number in accordance with the accepted rules", and the ITA's own portal
-- (deck vat_israel-invoice-280425): "על מבקש ההקצאה (הספק) לבטל את
-- החשבונית ולהוציא במקומה חשבונית חדשה עם מע"מ בשיעור אפס". The refused
-- original is cancelled (storno) once the special allocation number
-- arrives; the replacement carries it, under its own fiscal number.
--
-- This column links the replacement to the original it replaces. Its
-- allocation request is sent with the original's Invoice_Id.
ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "reverse_charge_replaces_id" uuid;

DO $$ BEGIN
  ALTER TABLE "outbound_invoices"
    ADD CONSTRAINT "outbound_invoices_reverse_charge_replaces_id_fk"
    FOREIGN KEY ("reverse_charge_replaces_id") REFERENCES "outbound_invoices"("id")
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "outbound_invoices_reverse_charge_replaces_idx"
  ON "outbound_invoices" ("reverse_charge_replaces_id")
  WHERE "reverse_charge_replaces_id" IS NOT NULL;
