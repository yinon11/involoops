-- Printed issue date, separate from the value/payment date in invoice_date.
-- Null on drafts and on documents issued before this column. Those older
-- rows keep using invoice_date as the date that was printed.
ALTER TABLE "outbound_invoices" ADD COLUMN IF NOT EXISTS "printed_date" date;
