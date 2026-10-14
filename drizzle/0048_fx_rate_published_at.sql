-- When the Bank of Israel published the cached rate (its `lastUpdate`).
--
-- The cache used to be keyed on when *we* fetched: a rate pulled at 08:00 —
-- still the previous day's, since BOI publishes around midday — counted as
-- "today's" and was used all afternoon. Keyed on publication instead, the
-- cache is current once today's rate is in hand; before that it is
-- refreshed at most hourly.
ALTER TABLE "fx_rates"
  ADD COLUMN IF NOT EXISTS "published_at" timestamp with time zone;

-- The same on each document: which day's representative rate it was issued at.
ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "fx_rate_published_at" timestamp with time zone;
