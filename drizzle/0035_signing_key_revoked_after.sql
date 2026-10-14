-- REVOKED signing keys can invalidate signatures after a cutoff.
--
-- revoked_after set: document_signatures.signed_at strictly after that
-- instant fail verification; earlier signatures from the same key stay
-- valid. revoked_after null while status is REVOKED: every signature
-- from the key fails. ACTIVE and RETIRED ignore this column.

ALTER TABLE "signing_keys"
  ADD COLUMN IF NOT EXISTS "revoked_after" timestamp with time zone;
