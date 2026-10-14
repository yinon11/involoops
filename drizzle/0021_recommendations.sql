-- AI Recommendations Engine: stores generated recommendations per user.
-- Types: missing_expense | tax_bracket | weekly_digest |
--        overdue_invoice | milestone_due | vat_refund
-- Priority: info | warning | urgent

CREATE TABLE IF NOT EXISTS "recommendations" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type"          text NOT NULL,
  "title"         text NOT NULL,
  "body"          text NOT NULL,
  "priority"      text NOT NULL DEFAULT 'info',  -- info | warning | urgent
  "dismissed_at"  timestamptz,
  "read_at"       timestamptz,
  "metadata"      jsonb DEFAULT '{}',
  "created_at"    timestamptz DEFAULT now() NOT NULL
);

-- Optimised for: list undismissed for a user, ordered newest first.
CREATE INDEX IF NOT EXISTS "recommendations_user_active_idx"
  ON "recommendations" ("user_id", "dismissed_at", "created_at" DESC);
