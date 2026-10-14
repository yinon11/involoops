-- Sponsored offers can run in the top bar as well as on the dashboard.
-- Existing campaigns keep their dashboard placement.
ALTER TABLE "sponsor_campaigns"
  ADD COLUMN IF NOT EXISTS "placement" text DEFAULT 'dashboard' NOT NULL;
--> statement-breakpoint
-- Campaign artwork, stored here and served from the app's own origin so the
-- partner never learns who opened a page.
ALTER TABLE "sponsor_campaigns"
  ADD COLUMN IF NOT EXISTS "image_updated_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sponsor_campaign_images" (
  "campaign_id" uuid PRIMARY KEY NOT NULL,
  "content_type" text NOT NULL,
  "data" bytea NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sponsor_campaign_images"
    ADD CONSTRAINT "sponsor_campaign_images_campaign_id_sponsor_campaigns_id_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "sponsor_campaigns"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- A user may object to their figures being used to choose offers.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "sponsor_targeting_opt_out" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "sponsor_targeting_opt_out_at" timestamp;
