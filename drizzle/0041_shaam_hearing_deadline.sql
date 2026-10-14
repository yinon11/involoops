-- מועד השימוע — the hearing deadline the ITA returns with a hold.
--
-- `lib/shaam/client.ts` has always parsed this value out of the clearance
-- response and then dropped it: there was nowhere to put it. The hearing
-- window is short and a hold the ITA leaves undecided inside it can end
-- with the allocation granted by default, so whether the window is still
-- open is exactly what the seller needs to see.
--
-- See `docs/ita-compliance/shaam-rejection-plan.md` §8.

ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "shaam_hearing_deadline" timestamp with time zone;
