-- Hashavshevet MOVEIN export — card mapping per business entity (admin UI).
CREATE TABLE IF NOT EXISTS "movein_export_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_entity_id" uuid NOT NULL,
  "export_email" varchar(255),
  "method" text DEFAULT 'detailed' NOT NULL,
  "general_cash" varchar(20) DEFAULT '0' NOT NULL,
  "credit_card_cash" varchar(20) DEFAULT '0' NOT NULL,
  "cash" varchar(20) DEFAULT '0' NOT NULL,
  "check_cash" varchar(20) DEFAULT '0' NOT NULL,
  "transfer_usd" varchar(20) DEFAULT '0' NOT NULL,
  "transfer_eur" varchar(20) DEFAULT '0' NOT NULL,
  "transfer_gbp" varchar(20) DEFAULT '0' NOT NULL,
  "transfer_jpy" varchar(20) DEFAULT '0' NOT NULL,
  "paypal" varchar(20) DEFAULT '0' NOT NULL,
  "bit" varchar(20) DEFAULT '0' NOT NULL,
  "pepper" varchar(20) DEFAULT '0' NOT NULL,
  "credit" varchar(20) DEFAULT '0' NOT NULL,
  "purchase" varchar(20) DEFAULT '0' NOT NULL,
  "input_vat" varchar(20) DEFAULT '0' NOT NULL,
  "withholding_tax" varchar(20) DEFAULT '0' NOT NULL,
  "output_vat" varchar(20) DEFAULT '0' NOT NULL,
  "income" varchar(20) DEFAULT '0' NOT NULL,
  "exempt_income" varchar(20) DEFAULT '0' NOT NULL,
  "cash_customer" varchar(20) DEFAULT '0' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "movein_export_settings_business_entity_id_unique" UNIQUE("business_entity_id")
);
--> statement-breakpoint
ALTER TABLE "movein_export_settings"
  ADD CONSTRAINT "movein_export_settings_business_entity_id_fk"
  FOREIGN KEY ("business_entity_id") REFERENCES "business_entities"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "movein_exports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_entity_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "requested_by_user_id" uuid NOT NULL,
  "status" text DEFAULT 'DONE' NOT NULL,
  "movement_count" integer,
  "invoice_count" integer,
  "s3_key_zip" text,
  "validation_errors" jsonb,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "movein_exports_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "movein_exports"
  ADD CONSTRAINT "movein_exports_business_entity_id_fk"
  FOREIGN KEY ("business_entity_id") REFERENCES "business_entities"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "movein_exports"
  ADD CONSTRAINT "movein_exports_requested_by_user_id_fk"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movein_exports_entity_created_at_idx"
  ON "movein_exports" ("business_entity_id", "created_at");
--> statement-breakpoint
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "external_account_number" varchar(20);
