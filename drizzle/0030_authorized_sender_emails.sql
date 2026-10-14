-- Additional invoice-forwarding sender addresses. A user proves ownership of
-- an extra email by clicking a tokenised link mailed to it; once verified the
-- address is accepted as a fallback intake match (below the To: alias and the
-- owner's own users.email). See src/db/schema/authorized-sender-emails.ts and
-- resolveUser() in src/lib/gmail/process-message.ts.
CREATE TABLE IF NOT EXISTS "authorized_sender_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"token" varchar(64),
	"expires_at" timestamp,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "authorized_sender_emails" ADD CONSTRAINT "authorized_sender_emails_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorized_sender_owner_idx" ON "authorized_sender_emails" USING btree ("owner_user_id");--> statement-breakpoint
-- A verified address belongs to exactly one account. Pending (unverified) rows
-- are exempt so a resend / concurrent-invite race doesn't hard-fail.
CREATE UNIQUE INDEX IF NOT EXISTS "authorized_sender_email_verified_uq" ON "authorized_sender_emails" USING btree (lower("email")) WHERE "verified_at" IS NOT NULL;
