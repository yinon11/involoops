-- Tax estimation feature.
--
-- 1. Add `vat_credit_percent` to inbound invoices so partial-credit categories
--    (e.g. fuel at 66%) can be tracked per-invoice. Defaults to 100 (full credit).
--    Auto-detection is deferred — the value is set manually for now.
--
-- 2. Create `tax_estimate_inputs` — one row per (user, year) that stores the
--    user-supplied adjustments needed for the income-tax and BL estimates:
--    credit points, monthly payroll cost, inventory flag, and fixed assets.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "vat_credit_percent" integer NOT NULL DEFAULT 100;

CREATE TABLE IF NOT EXISTS "tax_estimate_inputs" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"              uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "year"                 integer NOT NULL,
  "tax_credit_points"    numeric(5, 2) NOT NULL DEFAULT 2.25,
  "monthly_payroll_cost" numeric(12, 2) NOT NULL DEFAULT 0,
  "has_inventory"        boolean NOT NULL DEFAULT false,
  "fixed_assets"         jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_at"           timestamp NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "year")
);

CREATE INDEX IF NOT EXISTS "tax_estimate_inputs_user_id_idx"
  ON "tax_estimate_inputs" ("user_id");
