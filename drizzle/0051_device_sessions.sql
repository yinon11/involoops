-- Phone sign-in. The refresh token is stored as an HMAC only.
CREATE TABLE IF NOT EXISTS "device_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "device_name" varchar(120) NOT NULL,
  "refresh_token_hash" varchar(128) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "created_by_ip" varchar(64),
  "last_used_at" timestamp,
  "last_used_ip" varchar(64),
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp
);

DO $$ BEGIN
  ALTER TABLE "device_sessions"
    ADD CONSTRAINT "device_sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "device_sessions_user_idx"
  ON "device_sessions" ("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "device_sessions_refresh_hash_idx"
  ON "device_sessions" ("refresh_token_hash");
