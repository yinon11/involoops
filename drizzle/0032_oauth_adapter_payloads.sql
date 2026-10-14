-- Opaque OAuth tokens, grants, and interaction sessions for the MCP
-- authorization server (oidc-provider). API keys are unchanged.
CREATE TABLE IF NOT EXISTS "oauth_adapter_payloads" (
	"model" varchar(64) NOT NULL,
	"id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"grant_id" text,
	"user_code" text,
	"uid" text,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "oauth_adapter_payloads_pkey" PRIMARY KEY ("model", "id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_adapter_grant_idx" ON "oauth_adapter_payloads" ("model", "grant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_adapter_uid_idx" ON "oauth_adapter_payloads" ("model", "uid");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_adapter_user_code_idx" ON "oauth_adapter_payloads" ("model", "user_code");
