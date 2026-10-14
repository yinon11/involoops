-- Sponsored offers on the home dashboard. Campaigns are created inactive;
-- events record impressions, dismissals and confirmed leads (with a
-- snapshot of exactly what the user agreed to share).
CREATE TABLE IF NOT EXISTS "sponsor_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "partner_name" text NOT NULL,
  "partner_mark" text NOT NULL,
  "category" text NOT NULL,
  "trigger" text NOT NULL,
  "min_amount" numeric(14, 2),
  "entity_types" jsonb,
  "copy" jsonb NOT NULL,
  "cta_url" text NOT NULL,
  "shared_fields" jsonb NOT NULL,
  "weight" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sponsor_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "shared_data" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sponsor_events"
    ADD CONSTRAINT "sponsor_events_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sponsor_events"
    ADD CONSTRAINT "sponsor_events_campaign_id_sponsor_campaigns_id_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "sponsor_campaigns"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sponsor_events_user_campaign_idx"
  ON "sponsor_events" ("user_id", "campaign_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sponsor_events_campaign_kind_idx"
  ON "sponsor_events" ("campaign_id", "kind", "created_at");
