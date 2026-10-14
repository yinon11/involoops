-- Email printed on this document. NULL = use the customer record
-- (documents created before this column). Empty string = the seller
-- cleared it, so nothing is printed.
ALTER TABLE "outbound_invoices" ADD COLUMN IF NOT EXISTS "customer_email" varchar(255);
