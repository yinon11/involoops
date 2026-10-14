-- "Show interest" votes for upcoming/teased features. Drives the live
-- count rendered by <FeatureTeaser> and feeds a future admin priority view.
--
-- Dedup is on (feature_slug, voter_key); voter_key is "user:<uuid>" for
-- logged-in voters and "ip:<sha256-hex>" for anonymous landing-page
-- visitors. We never store raw IPs.
--
-- See `src/db/schema/feature-interest-votes.ts` for column-level docs and
-- `src/lib/teasers/config.ts` for the catalogue of valid `feature_slug`
-- values.

CREATE TABLE IF NOT EXISTS "feature_interest_votes" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feature_slug" varchar(64) NOT NULL,
  "user_id"      uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "voter_key"    varchar(96) NOT NULL,
  "created_at"   timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "feature_interest_votes_feature_voter_unique"
  ON "feature_interest_votes" ("feature_slug", "voter_key");

CREATE INDEX IF NOT EXISTS "feature_interest_votes_feature_idx"
  ON "feature_interest_votes" ("feature_slug");

CREATE INDEX IF NOT EXISTS "feature_interest_votes_user_idx"
  ON "feature_interest_votes" ("user_id");
