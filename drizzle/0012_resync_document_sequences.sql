-- Heal sequence drift introduced by migration 0010 / commit c7decf2.
--
-- Background: 0010 made `outbound_invoices.{sequence_number, formatted_number,
-- invoice_number}` nullable so drafts no longer burn a fiscal number. The
-- migration changed the schema but did NOT clean up existing draft rows
-- that were created BEFORE the change — those drafts still hold
-- sequence numbers from the eager-allocation era. Result: the
-- `document_number_sequences.current_number` counter is below the actual
-- max sequence already present in `outbound_invoices`, so the issue
-- flow's `INSERT … ON CONFLICT DO UPDATE` allocator hands out a number
-- that's already taken by an old draft and the UPDATE on outbound_invoices
-- explodes against `outbound_invoices_user_type_year_seq_unique`.
--
-- Fix in two atomic steps:
--   1. Release every still-draft row from its eagerly-assigned number.
--      Drafts are not legally documents yet (per ITA Pinkasei Hashbonot
--      §23-A and the rationale captured in 0010), so it's safe — and
--      now mandatory — for them to carry NULL until the user issues.
--   2. Resync each `document_number_sequences` row to the live MAX of
--      the corresponding (business_entity_id, document_type, tax_year)
--      group in `outbound_invoices`. We use GREATEST so the counter
--      never goes BACKWARDS even in pathological cases (e.g. a tenant
--      whose counter was bumped by an admin without a corresponding
--      row insert).

-- 1) Release draft numbers.
UPDATE "outbound_invoices"
SET
  "sequence_number"  = NULL,
  "formatted_number" = NULL,
  "invoice_number"   = NULL
WHERE "status" = 'draft'
  AND "sequence_number" IS NOT NULL;

-- 2) Resync the per-tenant counter. After step 1 the only rows with a
-- non-null sequence_number are non-drafts (issued / sent / paid /
-- voided), which is exactly the universe `current_number` must cover.
WITH live_max AS (
  SELECT
    "business_entity_id",
    "user_id",
    "document_type",
    "tax_year",
    MAX("sequence_number") AS max_seq
  FROM "outbound_invoices"
  WHERE "sequence_number" IS NOT NULL
  GROUP BY "business_entity_id", "user_id", "document_type", "tax_year"
)
INSERT INTO "document_number_sequences"
  ("business_entity_id", "user_id", "document_type", "tax_year", "current_number", "updated_at")
SELECT
  live_max."business_entity_id",
  live_max."user_id",
  live_max."document_type",
  live_max."tax_year",
  live_max.max_seq,
  NOW()
FROM live_max
ON CONFLICT ("business_entity_id", "document_type", "tax_year")
DO UPDATE SET
  "current_number" = GREATEST(
    "document_number_sequences"."current_number",
    EXCLUDED."current_number"
  ),
  "updated_at" = NOW();
