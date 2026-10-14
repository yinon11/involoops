-- The exchange rate a foreign-currency document was issued at, frozen.
--
-- Until now the ILS figures of a USD document were recomputed with whatever
-- rate was current at render or export time, so the uniform-structure
-- export of an old invoice used today's rate, not the one printed on it.
-- The ITA allocation request makes it worse: the amounts it is sent must be
-- the ILS amounts on the document, and the threshold test is in ILS.
--
-- Set once, when the fiscal number is allocated; NULL for ILS documents
-- and for drafts. `fx_rate_source` says where it came from: "boi" (that
-- day's Bank of Israel representative rate), "boi_stale" (an earlier day's,
-- when BOI was unreachable) or "env" (static fallback).
ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "fx_rate_to_ils" numeric(18, 6);
ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "fx_rate_source" varchar(16);
ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "fx_rate_fetched_at" timestamp with time zone;
