-- The first download or email of an issued document is the original
-- (מקור). This timestamp records that handout so every later one is
-- the certified copy (העתק נאמן למקור). Cleared when a new original
-- is published after an allocation number is stamped.
ALTER TABLE "outbound_invoices"
  ADD COLUMN IF NOT EXISTS "original_released_at" timestamp with time zone;
