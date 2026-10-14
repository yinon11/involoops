DROP TABLE IF EXISTS "stripe_billing_invoices";
--> statement-breakpoint
CREATE TABLE "subscription_billing_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_invoice_id" varchar(255) NOT NULL,
	"status" varchar(20) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"outbound_invoice_id" uuid,
	"formatted_number" varchar(128),
	"pdf_storage_key" varchar(2048),
	"invoice_date" date,
	"paid_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_billing_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "subscription_billing_receipts_outbound_invoice_id_outbound_invoices_id_fk" FOREIGN KEY ("outbound_invoice_id") REFERENCES "public"."outbound_invoices"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "subscription_billing_receipts_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE INDEX "subscription_billing_receipts_user_idx" ON "subscription_billing_receipts" USING btree ("user_id","paid_at");
