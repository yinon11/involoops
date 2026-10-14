CREATE TABLE "stripe_billing_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_invoice_id" varchar(255) NOT NULL,
	"stripe_customer_id" varchar(255) NOT NULL,
	"stripe_subscription_id" varchar(255),
	"status" varchar(32) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"amount_due" integer DEFAULT 0 NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"invoice_number" varchar(64),
	"hosted_invoice_url" varchar(2048),
	"invoice_pdf" varchar(2048),
	"period_start" timestamp,
	"period_end" timestamp,
	"finalized_at" timestamp,
	"paid_at" timestamp,
	"stripe_created_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_billing_invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "stripe_billing_invoices_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE INDEX "stripe_billing_invoices_user_idx" ON "stripe_billing_invoices" USING btree ("user_id","stripe_created_at");
