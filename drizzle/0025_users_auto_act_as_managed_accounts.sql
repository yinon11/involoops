-- Per-user override for the per-link auto_act_as flag on account_links.
--
-- A manager (admin / accountant) with one linked managed account currently
-- gets auto-switched into that managed account on sign-in (see migration
-- 0024 and src/app/api/auth/resolve-entry-session/route.ts). This new flag
-- on `users` lets a manager opt out of that behaviour for their own login
-- regardless of how the link is configured — useful for platform admins
-- who manage a sub-user but still need to spend most of their time on
-- their own account.
--
-- Default is TRUE so the existing flow continues to apply to everyone who
-- currently relies on it. Platform admins are flipped to FALSE in the
-- same migration since auto-switching into a sub-user almost always
-- denies them access to the admin tools they actually signed in for.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "auto_act_as_managed_accounts" boolean NOT NULL DEFAULT true;

UPDATE "users"
SET "auto_act_as_managed_accounts" = false
WHERE "is_admin" = true;
