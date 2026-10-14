-- Onboarding state for the unified shell wizard.
-- business_type: 'freelancer' | 'small_business' | null
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "onboarding_step" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "business_type" text;
