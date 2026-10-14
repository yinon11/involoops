-- Reverse charge, route A: an invoice the seller issues at zero VAT because
-- the buyer agreed to self-report the VAT (היפוך חיוב).
--
-- `reverse_charge` marks the document so the printout carries the caption
-- the spec requires ("Customer must self-report this invoice") and so
-- issuing can insist on a signed consent that still covers it.
-- `reverse_charge_consent_id` records which consent it was issued on. No
-- foreign key: the consent row already cascades with its invoice, and the
-- two tables would otherwise reference each other.
ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "reverse_charge" boolean NOT NULL DEFAULT false;
ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "reverse_charge_consent_id" uuid;

-- Where the signed consent was archived (object-lock bucket), so the
-- evidence outlives any later change to the row it was rendered from.
ALTER TABLE "reverse_charge_consents"
  ADD COLUMN IF NOT EXISTS "archive_key" text;
-- The exact text the buyer signed. `consent_text_hash` alone proves the
-- text, but only if it can be reproduced — and rewording the consent later
-- would make earlier texts unreproducible.
ALTER TABLE "reverse_charge_consents"
  ADD COLUMN IF NOT EXISTS "consent_text" text;
ALTER TABLE "reverse_charge_consents"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'REVERSE_CHARGE_APPLIED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'REVERSE_CHARGE_REMOVED';

-- Archive object kind for the signed consent PDF.
ALTER TYPE "archive_object_kind" ADD VALUE IF NOT EXISTS 'REVERSE_CHARGE_CONSENT';
