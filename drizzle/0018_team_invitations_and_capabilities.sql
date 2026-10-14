-- Sub-user / team invitations and capability grants.
--
-- 1. Add a `capabilities` JSONB array to the existing account_links table so
--    each (manager → managed) link records what the sub-user can do while
--    acting as the owner.
-- 2. Create `account_invitations` for pending email invites carrying an
--    expiring single-use token.

ALTER TABLE "account_links"
  ADD COLUMN IF NOT EXISTS "capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS "account_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "email" varchar(255) NOT NULL,
  "token" varchar(64) NOT NULL UNIQUE,
  "capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "expires_at" timestamp NOT NULL,
  "accepted_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "account_invitations_owner_idx"
  ON "account_invitations" ("owner_user_id");
CREATE INDEX IF NOT EXISTS "account_invitations_email_idx"
  ON "account_invitations" ("email");
