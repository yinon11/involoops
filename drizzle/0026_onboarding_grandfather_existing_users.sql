-- 0022 added onboarding_completed DEFAULT false, which sent every existing user
-- to /welcome. Mark accounts that already use the product as done; brand-new
-- sign-ups (no invoices / entity yet) still start on the wizard.
UPDATE "users" u
SET
  "onboarding_completed" = true,
  "onboarding_step" = GREATEST(u."onboarding_step", 99)
WHERE u."onboarding_completed" = false
  AND (
    EXISTS (SELECT 1 FROM "invoices" i WHERE i."user_id" = u."id" LIMIT 1)
    OR EXISTS (
      SELECT 1 FROM "business_entities" be
      WHERE be."owner_user_id" = u."id"
      LIMIT 1
    )
    OR EXISTS (
      SELECT 1 FROM "outbound_invoices" o
      WHERE o."user_id" = u."id"
      LIMIT 1
    )
  );
