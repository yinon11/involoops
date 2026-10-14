-- Suppresses the post-approve prompt that asks the user whether they want to
-- auto-approve future invoices from a vendor when they approved the current
-- one without making any edits. Defaults to false (prompt shown); flipped to
-- true either via the dialog's "don't show again" checkbox or the setting on
-- the Settings → Invoices tab.
-- Idempotent — see 0011 for the rationale.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "suppress_auto_approve_prompt" boolean NOT NULL DEFAULT false;
