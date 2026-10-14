-- Google sign-in already proves the address, but Auth.js stores
-- email_verified as null for every new OAuth user. Password signups
-- have no Google account row and stay unverified until they click
-- the link.
UPDATE "users" u
SET "email_verified" = NOW()
WHERE u."email_verified" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "accounts" a
    WHERE a."user_id" = u."id"
      AND a."provider" = 'google'
  );
