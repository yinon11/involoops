-- Per-tenant default for the VAT toggle on the create-invoice form.
--
-- Israeli invoicing always uses one of two VAT rates: the statutory
-- rate (currently 18%) when the seller charges VAT, or 0% (no VAT —
-- e.g. Osek Patur, export, or VAT-exempt services). Free-form % entry
-- on every invoice is a foot-gun that produces invalid documents, so
-- the create-invoice form now exposes a binary "include VAT" toggle
-- and reads its initial state from this column. The user can still
-- flip it per invoice.
--
-- Default is TRUE (include VAT) because the majority of Osek Murshe /
-- חברה בע״מ tenants charge VAT. Osek Patur tenants will flip it once
-- in their business details and never look at it again.

-- Idempotent: this column may already exist on environments that ran
-- `drizzle-kit push` against `src/db/schema/*.ts` before the team
-- switched to file-based migrations. `IF NOT EXISTS` makes the migration
-- safe to re-apply on any environment regardless of how it was seeded.
ALTER TABLE "business_entities"
  ADD COLUMN IF NOT EXISTS "default_vat_inclusive" boolean NOT NULL DEFAULT true;
