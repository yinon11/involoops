-- Bank-transfer details on the invoice template, printed on the
-- payment-request family only (חשבונית מס / חשבון עסקה). Off by default so
-- existing templates keep rendering exactly as they do today.
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "show_bank_details" boolean DEFAULT false;
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "bank_account_holder" varchar(255);
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "bank_name" varchar(120);
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "bank_branch" varchar(60);
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "bank_account_number" varchar(60);
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "bank_iban" varchar(60);
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "bank_swift" varchar(20);
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "bank_transfer_note" text;
