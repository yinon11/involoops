-- Per-user feature entitlement grants. Layers on top of pricing-tier
-- defaults: a row here means the user has that feature regardless of plan
-- (typically: staff, beta cohort, comped customer, time-bounded trial).
--
-- The list of valid `feature` strings lives in code at
-- `src/lib/features/registry.ts`; this table only records grants. Adding
-- a new feature is therefore a typed code change, not a migration.
--
-- See `src/db/schema/user-feature-grants.ts` for column-level commentary.

CREATE TABLE IF NOT EXISTS "user_feature_grants" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "feature"     varchar(64) NOT NULL,
  "granted_by"  uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "granted_at"  timestamp DEFAULT now() NOT NULL,
  "expires_at"  timestamp,
  "reason"      text,
  "revoked_at"  timestamp
);

-- One *active* grant per (user, feature). Revoked rows are excluded so a
-- fresh grant can be re-issued without first deleting the old row.
CREATE UNIQUE INDEX IF NOT EXISTS "user_feature_grants_user_feature_active_unique"
  ON "user_feature_grants" ("user_id", "feature")
  WHERE "revoked_at" IS NULL;

-- Resolver hot path: list active grants for a user. The partial index above
-- already covers (user_id, feature); this btree on user_id alone speeds up
-- the "load all my features" query the shell runs once per request.
CREATE INDEX IF NOT EXISTS "user_feature_grants_user_id_idx"
  ON "user_feature_grants" ("user_id");
