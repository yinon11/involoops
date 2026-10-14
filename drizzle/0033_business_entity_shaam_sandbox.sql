-- Per-entity SHAAM sandbox. Sandboxed entities never call the production
-- ITA clearance API. Sample Studio Ltd (the MCP reviewer business) is
-- the only row turned on here.

ALTER TABLE "business_entities"
  ADD COLUMN IF NOT EXISTS "shaam_sandbox" boolean NOT NULL DEFAULT false;

ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "sandbox_document" boolean NOT NULL DEFAULT false;

UPDATE "business_entities"
SET "shaam_sandbox" = true
WHERE "osek_murshe" = '515555555'
  AND "legal_name" = 'Sample Studio Ltd';
