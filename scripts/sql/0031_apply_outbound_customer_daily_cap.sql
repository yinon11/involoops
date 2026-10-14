--------------------------------------------------------------------------------
-- InvoLoops - apply migration 0031 (per-customer daily cap)
--
-- Run against sandbox, then production. Safe to run more than once: every
-- statement is guarded, so re-running changes nothing.
--
-- Plain ASCII SQL, no psql directives, no semicolons inside comments, and no
-- UPDATE..FROM - so it survives GUI clients that split the buffer themselves.
-- Paste the whole file and execute, or: psql "$DATABASE_URL" -f <this file>
--
-- Source of truth: drizzle/0031_outbound_customer_daily_cap.sql
--------------------------------------------------------------------------------


-- STEP 1 of 4. Per-account override column. NULL, which is every existing
-- account, means "use the product default" held in code as
-- DEFAULT_MAX_OUTBOUND_DOCS_PER_CUSTOMER_PER_DAY.
-- A "column already exists, skipping" notice here is fine and expected.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS max_outbound_invoices_per_customer_per_day integer;


-- STEP 2 of 4. The column the cap counts. Stamped from now on in the same
-- transaction that allocates a fiscal number.
-- A "column already exists, skipping" notice here is fine and expected.

ALTER TABLE outbound_invoices
  ADD COLUMN IF NOT EXISTS issued_at timestamp with time zone;


-- STEP 3 of 4. THE ONE THAT MATTERS. Give documents issued before this
-- migration an issued_at, copied from their signature. There is one signature
-- row per issued document, so signed_at is the best record of when it issued.
--
-- Drafts, and any document whose issue attempt died before archiving, have no
-- signature and correctly stay NULL - they never count against the cap.
--
-- Skip this and every historical document looks un-issued, so the 100-per-
-- customer-per-day cap would start every customer back at zero.
--
-- Written as a correlated subquery rather than UPDATE..FROM so that a client
-- which splits statements on its own cannot separate the SET from its source.
-- Expect "UPDATE <n>" where n is about your number of signed documents.

UPDATE outbound_invoices oi
SET issued_at = (
      SELECT ds.signed_at
      FROM document_signatures ds
      WHERE ds.document_id = oi.id
      LIMIT 1
    )
WHERE oi.issued_at IS NULL
  AND EXISTS (
      SELECT 1
      FROM document_signatures ds2
      WHERE ds2.document_id = oi.id
    );


-- STEP 4 of 4. Index backing the cap's COUNT. Partial, because only issued
-- rows are ever counted and drafts dominate the table.
--
-- This takes a brief write lock, which is fine for sandbox and for any table
-- of ordinary size. On a very large production table, skip this statement and
-- run the CONCURRENTLY version in the comment below instead - it does not
-- block writes, but it cannot run inside a transaction, so run it by itself.

CREATE INDEX IF NOT EXISTS outbound_invoices_customer_issued_at_idx
  ON outbound_invoices USING btree (customer_id, issued_at)
  WHERE issued_at IS NOT NULL;

-- Production alternative, run on its own:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS outbound_invoices_customer_issued_at_idx
--     ON outbound_invoices USING btree (customer_id, issued_at)
--     WHERE issued_at IS NOT NULL


-- CHECK. backfilled should be close to signatures_expected. still_null is
-- drafts plus any half-issued documents and is expected to be non-zero.

SELECT
  count(*) FILTER (WHERE issued_at IS NOT NULL) AS backfilled,
  count(*) FILTER (WHERE issued_at IS NULL)     AS still_null,
  count(*)                                      AS total,
  (SELECT count(*) FROM document_signatures)    AS signatures_expected
FROM outbound_invoices;
