-- One active state per (user, funnel) for the email-funnel pipeline.
--
-- Background: `enterFunnel` (src/lib/email/funnel-event-service.ts) uses a
-- non-atomic read-then-write to enforce "user is not already in this funnel".
-- Two concurrent `PLAN_LIMIT_REACHED` events from parallel at-cap uploads
-- could both pass that check and both insert a state row, after which the
-- cron sent the same funnel email twice (incident 2026-04-23).
--
-- Postgres enforces the invariant we wanted at the DB level. Completed /
-- exited states are excluded so a future re-entry into a (re-entrant)
-- funnel is not blocked by historical rows. The application code catches
-- the unique-violation and treats it as the race-loser path equivalent to
-- the existing "already in this funnel" early-return.
--
-- Cleanup of any pre-existing duplicate active rows is done first so the
-- index can be created. We keep the earliest-entered row per (user, funnel)
-- and mark the rest as exited with a clear reason for audit; the cron's
-- `status='active'` filter then ignores them.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "user_id", "funnel_id"
      ORDER BY COALESCE("entered_at", '1970-01-01'::timestamp), "id"
    ) AS rn
  FROM "user_email_funnel_states"
  WHERE "status" = 'active'
)
UPDATE "user_email_funnel_states" AS s
SET
  "status"      = 'exited',
  "exit_reason" = 'duplicate_active_dedupe',
  "exited_at"   = now(),
  "next_email_at" = NULL
FROM ranked
WHERE s."id" = ranked."id"
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "uefs_user_funnel_active_unique"
  ON "user_email_funnel_states" ("user_id", "funnel_id")
  WHERE "status" = 'active';
