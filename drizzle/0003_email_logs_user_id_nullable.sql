-- Make email_logs.user_id nullable to support admin-recipient transactional
-- emails (signup notifications, contact form, etc.) and other system emails
-- with no recipient user. Per-user emails continue to set this column.
ALTER TABLE "email_logs" ALTER COLUMN "user_id" DROP NOT NULL;
