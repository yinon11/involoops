-- Spec 08+ — resolving an ITA allocation refusal.
--
-- When רשות המסים refuses to allocate a number, the seller must pick one
-- of the statutory options rather than being left on a blocked draft.
-- These columns record which option was taken, when, and by whom.
-- See `docs/ita-compliance/shaam-rejection-plan.md`.
--
-- `shaam_status` is a plain text column (the allowed set is enforced in
-- TypeScript, not the DB), so the two new states
-- ISSUED_WITHOUT_ALLOCATION / CANCELLED_AFTER_REJECTION need no DDL.

ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "shaam_rejection_choice" text;
ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "shaam_rejection_choice_at" timestamp with time zone;
ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "shaam_rejection_choice_by" uuid;

DO $$
BEGIN
  ALTER TABLE "outbound_invoices"
    ADD CONSTRAINT "outbound_invoices_shaam_rejection_choice_by_users_id_fk"
    FOREIGN KEY ("shaam_rejection_choice_by") REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Audit event for the seller's decision. Kept separate from
-- SHAAM_REJECTED, which records the ITA's answer rather than ours.
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'SHAAM_REJECTION_RESOLVED';
