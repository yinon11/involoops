-- Buyer consent to a reverse charge (היפוך חיוב), and the evidence for it.
--
-- ITA v2.0 spec §2.2.2: "Upon obtaining the customer's consent (in any way
-- agreed between the parties), the reverse charge action will be executed."
-- The spec leaves the mechanism to the software. This table is that
-- mechanism, written to be shown to an auditor: who signed, exactly what
-- they were shown, exactly what they agreed to, from where, and when.
--
-- The link token is stored as a SHA-256 hash only, so a leaked row cannot be
-- used to sign on the buyer's behalf. `document_snapshot_hash` pins the
-- invoice facts the buyer agreed to; if the invoice changes afterwards the
-- consent does not cover it. See src/db/schema/reverse-charge-consents.ts.

CREATE TABLE IF NOT EXISTS "reverse_charge_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "business_entity_id" uuid NOT NULL,
  "customer_id" uuid,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_by_user_id" uuid,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recipient_email" varchar(255) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "seller_acknowledged_at" timestamp with time zone NOT NULL,
  "seller_acknowledgement_version" varchar(32) NOT NULL,
  "document_snapshot" jsonb NOT NULL,
  "document_snapshot_hash" varchar(64) NOT NULL,
  "consent_text_version" varchar(32) NOT NULL,
  "signed_at" timestamp with time zone,
  "signer_name" varchar(200),
  "signer_role" varchar(200),
  "consent_locale" varchar(5),
  "consent_text_hash" varchar(64),
  "signature_png" text,
  "signer_ip" varchar(64),
  "signer_user_agent" text,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reverse_charge_consents_token_hash_unique" UNIQUE ("token_hash")
);

DO $$ BEGIN
  ALTER TABLE "reverse_charge_consents"
    ADD CONSTRAINT "reverse_charge_consents_document_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "outbound_invoices"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reverse_charge_consents"
    ADD CONSTRAINT "reverse_charge_consents_business_entity_id_fk"
    FOREIGN KEY ("business_entity_id") REFERENCES "business_entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reverse_charge_consents"
    ADD CONSTRAINT "reverse_charge_consents_customer_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reverse_charge_consents"
    ADD CONSTRAINT "reverse_charge_consents_requested_by_user_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "reverse_charge_consents_document_idx"
  ON "reverse_charge_consents" ("document_id");
CREATE INDEX IF NOT EXISTS "reverse_charge_consents_entity_idx"
  ON "reverse_charge_consents" ("business_entity_id");

-- Audit events for the consent. Same approach as 0040: ADD VALUE is safe
-- inside the transaction drizzle wraps each migration in on PostgreSQL 12+.
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'REVERSE_CHARGE_CONSENT_REQUESTED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'REVERSE_CHARGE_CONSENT_SIGNED';
