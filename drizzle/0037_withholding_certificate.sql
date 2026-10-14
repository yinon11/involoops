-- One current אישור ניכוי מס במקור per business, plus the choice
-- made when a SHAAM-gated send is queued.

ALTER TABLE "business_entities"
  ADD COLUMN IF NOT EXISTS "withholding_certificate_key" text,
  ADD COLUMN IF NOT EXISTS "withholding_certificate_filename" text,
  ADD COLUMN IF NOT EXISTS "withholding_certificate_uploaded_at" timestamp,
  ADD COLUMN IF NOT EXISTS "withholding_certificate_valid_until" date,
  ADD COLUMN IF NOT EXISTS "attach_withholding_certificate" boolean NOT NULL DEFAULT false;

ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "queued_delivery_attach_certificate" boolean NOT NULL DEFAULT false;
