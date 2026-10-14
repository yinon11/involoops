-- Recorded counts of distinct people held in the database (privacy amendment 13).
CREATE TABLE IF NOT EXISTS "privacy_population_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "taken_at" timestamp with time zone DEFAULT now() NOT NULL,
  "taken_by_user_id" uuid,
  "total_people" integer NOT NULL,
  "breakdown" jsonb NOT NULL,
  "note" text
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "privacy_population_snapshots"
    ADD CONSTRAINT "privacy_population_snapshots_taken_by_user_id_users_id_fk"
    FOREIGN KEY ("taken_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
