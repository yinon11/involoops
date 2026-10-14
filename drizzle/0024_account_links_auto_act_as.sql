-- Auto-act-as on sign-in for sub-users.
--
-- When a sub-user (the account_link's manager) has exactly one linked owner
-- (the account_link's managed) and this flag is true, the sign-in flow will
-- automatically switch them into the owner's account so they never have to
-- click "Switch account" after every login.
--
-- Owners can disable this per member (e.g. an external accountant who also
-- runs their own account on the platform). Default is true because the
-- common case is a dedicated sub-user with no own data.

ALTER TABLE "account_links"
  ADD COLUMN IF NOT EXISTS "auto_act_as" boolean NOT NULL DEFAULT true;
