-- Drafts no longer burn a fiscal sequence number.
--
-- Israeli ITA bookkeeping rules (Hora'ot Mas Hachnasa - Niho'ul Pinkasei
-- Cheshbonot, sec. 23-A and friends) require gap-free continuity for
-- *issued* invoices ("חשבוניות שהוצאו ללקוחות"). Drafts have no legal
-- existence yet, so allocating a fiscal number at draft creation creates
-- holes in the issued sequence whenever a user discards a draft.
--
-- iCount, Green Invoice (Morning), EZcount, Invoice4U all allocate the
-- gap-free number at issue ("הפקה") time, not at draft save. This
-- migration aligns our schema with that model:
--
--   1. invoice_number, formatted_number, and sequence_number become
--      nullable so drafts can be persisted without burning a number.
--   2. A row-level CHECK enforces that any non-draft row carries all
--      three columns. The transition draft -> issued (in
--      issueOutboundInvoiceOp) is responsible for allocating and
--      stamping the values atomically before flipping status.

ALTER TABLE "outbound_invoices"
  ALTER COLUMN "invoice_number"   DROP NOT NULL,
  ALTER COLUMN "formatted_number" DROP NOT NULL,
  ALTER COLUMN "sequence_number"  DROP NOT NULL;

ALTER TABLE "outbound_invoices"
  ADD CONSTRAINT "outbound_invoices_issued_has_number"
  CHECK (
    status = 'draft'
    OR (
      invoice_number   IS NOT NULL
      AND formatted_number IS NOT NULL
      AND sequence_number  IS NOT NULL
    )
  );
