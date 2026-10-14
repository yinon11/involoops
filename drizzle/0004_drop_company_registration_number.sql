-- Drop the legacy company_registration_number column from
-- business_entities. The 9-digit identifier on every invoice (Osek
-- Murshe / ח.פ. / ע.ר. / partnership number) now lives only in
-- `osek_murshe`; its label is rendered per `entity_type` at the UI
-- layer. Safe to drop because no signed invoices reference it.
ALTER TABLE "business_entities" DROP COLUMN IF EXISTS "company_registration_number";
