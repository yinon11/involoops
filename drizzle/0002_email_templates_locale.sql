-- Add per-locale variants to email_templates.
--
-- Existing rows are stamped with locale='en' (default), so funnel sends keep
-- working unchanged. Hebrew variants are inserted as new rows sharing the same
-- `code`. Renderer falls back to `locale='en'` when the requested locale is
-- missing, so partial translations are safe.

ALTER TABLE "email_templates" DROP CONSTRAINT IF EXISTS "email_templates_code_unique";
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "locale" varchar(8) DEFAULT 'en' NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_code_locale_idx" ON "email_templates" ("code", "locale");
