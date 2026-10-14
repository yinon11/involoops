-- Drop the `needs_review` / `review_notes` columns on invoices. The dedicated
-- /review page is gone: extraction failures land as `pending`, and possible
-- invoice-number collisions now surface only on the Duplicates page. The
-- low-confidence "approved but please double-check" flow has been retired —
-- approved means approved.
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "needs_review";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "review_notes";
