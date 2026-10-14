-- Record that an issued document received cash above the ceiling in
-- the Law for the Reduction of the Use of Cash. The document still
-- issues; this is the internal register of those transactions.
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'CASH_CEILING_EXCEEDED';
