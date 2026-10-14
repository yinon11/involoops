-- Operator settings changed from the admin panel at runtime (one row per
-- key). First use: the sandbox-only "Tax Authority answer" override
-- (key `sandbox.shaam_mock_outcome`), which forces a refusal, hold or
-- outage for testing and is ignored outside the sandbox stack.
CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid
);

DO $$ BEGIN
  ALTER TABLE "app_settings"
    ADD CONSTRAINT "app_settings_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
