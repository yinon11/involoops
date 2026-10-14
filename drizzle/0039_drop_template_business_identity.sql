-- Drop the issuer-identity columns that used to shadow business_entities.
--
-- These were never read by any render path: every invoice, draft or
-- issued, takes its legal name, address and tax ID from business_entities
-- (or from the signed canonical JSON for issued documents). The template
-- editor nonetheless offered them as editable fields, so a user could type
-- a tax ID here and believe their invoices carried it. The editor now shows
-- the real identity read-only, the v1 API no longer accepts or returns
-- these fields, and the columns go with them.
--
-- The data is branding text a user typed into a page whose values were
-- discarded at render time, so there is nothing to migrate into
-- business_entities: that table already holds the authoritative values.
ALTER TABLE "invoice_templates" DROP COLUMN IF EXISTS "business_name";
ALTER TABLE "invoice_templates" DROP COLUMN IF EXISTS "business_address";
ALTER TABLE "invoice_templates" DROP COLUMN IF EXISTS "business_tax_id";
