-- Spec: auto-detect fixed assets from uploaded expense invoices.
--
-- Three new columns on `invoices` to support classification (LLM-driven)
-- and one-shot sync into tax_estimate_inputs.fixed_assets:
--
--   * expense_category — free-text label (e.g. "computer", "vehicle",
--     "office furniture", "software license", "phone"). NULL when
--     classification was unclear or extraction failed.
--   * is_fixed_asset    — true when AI or user flags the row as a capital
--     expenditure (computers, phones, vehicles, machinery, furniture,
--     multi-year software licenses). Defaults to false; if classification
--     fails the existing flow stays unchanged.
--   * fixed_asset_synced — true once this invoice has been appended to
--     tax_estimate_inputs.fixed_assets so the confirmation prompt and the
--     "Import from expenses" picker can hide already-handled rows.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "expense_category" text,
  ADD COLUMN IF NOT EXISTS "is_fixed_asset" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fixed_asset_synced" boolean NOT NULL DEFAULT false;
