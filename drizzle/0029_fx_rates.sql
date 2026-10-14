-- Locally-cached FX rates (daily refresh). Today only USD->ILS is stored,
-- used for the ILS figures printed on issued USD tax documents and for
-- statutory ILS amounts in accounting exports. See src/lib/fx/usd-ils-rate.ts.
CREATE TABLE IF NOT EXISTS "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base" varchar(3) NOT NULL,
	"quote" varchar(3) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"source" varchar(32) DEFAULT 'boi' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_base_quote_unique" UNIQUE("base","quote");
EXCEPTION
	WHEN duplicate_table THEN NULL;
	WHEN duplicate_object THEN NULL;
END $$;
