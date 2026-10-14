CREATE TYPE "public"."archive_object_kind" AS ENUM('CANONICAL_JSON', 'SIGNATURE', 'PDF', 'AUDIT_BUNDLE', 'PDF_FINAL', 'UNIFORM_STRUCTURE_INI', 'UNIFORM_STRUCTURE_BKMVDATA');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('OSEK_MURSHE', 'OSEK_PATUR', 'CHEVRA_BAAM', 'AMUTA', 'SHUTAFUT');--> statement-breakpoint
CREATE TYPE "public"."business_role" AS ENUM('OWNER', 'ACCOUNTANT', 'ISSUER', 'VIEWER', 'AUDITOR');--> statement-breakpoint
CREATE TYPE "public"."audit_event_type" AS ENUM('CREATED', 'UPDATED', 'STATUS_CHANGED', 'VOIDED', 'SIGNED', 'ARCHIVED', 'SHAAM_SUBMITTED', 'SHAAM_ALLOCATION_RECEIVED', 'SHAAM_REJECTED', 'PDF_GENERATED', 'VIEWED', 'EXPORTED', 'CREDIT_NOTE_ISSUED');--> statement-breakpoint
CREATE TYPE "public"."document_link_type" AS ENUM('CREDIT_REVERSES', 'CREDIT_PARTIAL', 'DELIVERY_NOTE_REFERENCES', 'CORRECTED_BY');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'RECEIPT', 'CREDIT_INVOICE', 'PROFORMA', 'DELIVERY_NOTE');--> statement-breakpoint
CREATE TYPE "public"."signing_key_algorithm" AS ENUM('RS256', 'RS384', 'RS512', 'ES256');--> statement-breakpoint
CREATE TYPE "public"."signing_key_status" AS ENUM('ACTIVE', 'RETIRED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."shaam_authorization_status" AS ENUM('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."shaam_environment" AS ENUM('UAT', 'PROD');--> statement-breakpoint
CREATE TYPE "public"."shaam_token_event_type" AS ENUM('AUTHORIZATION_GRANTED', 'ACCESS_TOKEN_REFRESHED', 'REFRESH_TOKEN_ROTATED', 'REFRESH_FAILED', 'TOKEN_REVOKED', 'AUTHORIZATION_EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."shaam_response_status" AS ENUM('APPROVED', 'REJECTED', 'HELD', 'TIMEOUT', 'NETWORK_ERROR', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_user_id" uuid NOT NULL,
	"managed_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_links_no_self_link" CHECK ("account_links"."manager_user_id" <> "account_links"."managed_user_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(255) NOT NULL,
	"provider" varchar(255) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" varchar(255),
	"scope" varchar(255),
	"id_token" text,
	"session_state" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_token" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "api_idempotency_keys" (
	"api_key_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"status" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_idempotency_keys_api_key_id_key_pk" PRIMARY KEY("api_key_id","key")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"public_id" varchar(64) NOT NULL,
	"secret_hash" varchar(128) NOT NULL,
	"mode" varchar(8) NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by_ip" varchar(64),
	"last_used_at" timestamp,
	"last_used_ip" varchar(64),
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"revoked_reason" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "archive_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"object_kind" "archive_object_kind" NOT NULL,
	"s3_bucket" text NOT NULL,
	"s3_key" text NOT NULL,
	"s3_version_id" text NOT NULL,
	"content_sha256" text NOT NULL,
	"content_length" bigint NOT NULL,
	"content_type" text NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stored_by_user_id" uuid NOT NULL,
	"chain_sequence" bigint NOT NULL,
	"chain_entry_hash" text NOT NULL,
	"chain_previous_hash" text,
	CONSTRAINT "archive_objects_entity_sequence_unique" UNIQUE("business_entity_id","chain_sequence")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"invoice_id" uuid,
	"action" varchar(50) NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "business_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"legal_name_en" text,
	"osek_murshe" text,
	"company_registration_number" text,
	"entity_type" "entity_type" DEFAULT 'OSEK_MURSHE' NOT NULL,
	"address" jsonb,
	"phone" text,
	"email" text,
	"tax_year_starts_month" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_entities_owner_user_id_unique" UNIQUE("owner_user_id")
);
--> statement-breakpoint
CREATE TABLE "business_entity_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "business_role" NOT NULL,
	"permissions" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_entity_members_entity_user_unique" UNIQUE("business_entity_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"tax_id" varchar(100),
	"notes" text,
	"auto_send_invoices" boolean,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dismissed_duplicate_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"invoice_id_a" uuid NOT NULL,
	"invoice_id_b" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dismissed_duplicate_pairs_ordered" CHECK ("dismissed_duplicate_pairs"."invoice_id_a" < "dismissed_duplicate_pairs"."invoice_id_b")
);
--> statement-breakpoint
CREATE TABLE "document_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"event_type" "audit_event_type" NOT NULL,
	"event_payload" jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_ip" text,
	"actor_user_agent" text,
	"previous_hash" text,
	"entry_hash" text NOT NULL,
	"sequence_number" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_audit_log_entity_sequence_unique" UNIQUE("business_entity_id","sequence_number")
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"from_document_id" uuid NOT NULL,
	"to_document_id" uuid NOT NULL,
	"link_type" "document_link_type" NOT NULL,
	"amount" numeric(14, 2),
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	CONSTRAINT "document_links_from_to_type_unique" UNIQUE("from_document_id","to_document_id","link_type")
);
--> statement-breakpoint
CREATE TABLE "document_number_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"tax_year" integer NOT NULL,
	"current_number" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_number_sequences_entity_type_year_unique" UNIQUE("business_entity_id","document_type","tax_year")
);
--> statement-breakpoint
CREATE TABLE "document_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"key_id" text NOT NULL,
	"algorithm" text NOT NULL,
	"canonical_json_hash" text NOT NULL,
	"signature_base64" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_by_user_id" uuid NOT NULL,
	"canonical_json" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_signatures_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "email_funnel_exits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"exit_condition" varchar(100) NOT NULL,
	"target_funnel_code" varchar(20),
	"is_success" boolean DEFAULT true NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "email_funnel_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"email_template_id" uuid NOT NULL,
	"delay_hours" integer DEFAULT 0 NOT NULL,
	"delay_from" varchar(20) DEFAULT 'previous_step' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_funnels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"funnel_group" varchar(50) NOT NULL,
	"description" text,
	"entry_event" varchar(100),
	"mutex_group" varchar(50),
	"is_reentrant" boolean DEFAULT false NOT NULL,
	"timeout_hours" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_transactional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "email_funnels_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "email_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_log_id" uuid NOT NULL,
	"url" text NOT NULL,
	"clicked_at" timestamp DEFAULT now(),
	"user_agent" text,
	"ip_address" varchar(45)
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_template_id" uuid NOT NULL,
	"email_funnel_id" uuid,
	"funnel_step" integer,
	"ses_message_id" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"bounced_at" timestamp,
	"complained_at" timestamp,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"bounce_type" varchar(50),
	"recipient_email" varchar(255) NOT NULL,
	"subject_snapshot" varchar(500),
	"variables_snapshot" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text,
	"template_type" varchar(50) DEFAULT 'funnel',
	"variables" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "email_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "email_verification_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "extraction_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vendor_id" uuid,
	"priority" integer DEFAULT 0,
	"name" varchar(255),
	"rules" jsonb NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gmail_watch_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox_email" varchar(255) NOT NULL,
	"last_history_id" varchar(64),
	"watch_expires_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_watch_state_mailbox_email_unique" UNIQUE("mailbox_email")
);
--> statement-breakpoint
CREATE TABLE "inbound_email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gmail_message_id" varchar(128) NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"from_address" varchar(320),
	"to_address" varchar(320),
	"subject" text,
	"dkim_pass" boolean,
	"matched_user_id" uuid,
	"outcome" varchar(32) NOT NULL,
	"error_message" text,
	"invoice_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	CONSTRAINT "inbound_email_log_gmail_message_id_unique" UNIQUE("gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"company_name" varchar(255),
	"display_currency" varchar(3),
	"password_hash" varchar(255),
	"is_admin" boolean DEFAULT false NOT NULL,
	"anthropic_api_key_ciphertext" text,
	"anthropic_api_key_iv" varchar(64),
	"anthropic_api_key_tag" varchar(64),
	"anthropic_api_key_hint" varchar(12),
	"anthropic_api_key_validated_at" timestamp,
	"invoice_alias" varchar(64),
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"marketing_opt_in_at" timestamp,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_ciphertext" text,
	"mfa_secret_iv" varchar(64),
	"mfa_secret_tag" varchar(64),
	"mfa_enabled_at" timestamp,
	"mfa_backup_codes" jsonb,
	"deletion_requested_at" timestamp,
	"deletion_scheduled_for" timestamp,
	"created_at" timestamp DEFAULT now(),
	"email_verified" timestamp,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"aliases" text[],
	"default_category" varchar(100),
	"is_income_source" boolean DEFAULT false,
	"auto_approve" boolean DEFAULT false,
	"website_url" varchar(1024),
	"website_url_2" varchar(1024),
	"tracking_excluded" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vendor_id" uuid,
	"suggested_vendor_name" varchar(512),
	"type" text DEFAULT 'expense',
	"status" text DEFAULT 'processing',
	"invoice_number" varchar(255),
	"invoice_date" date,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'ILS',
	"vat_amount" numeric(12, 2),
	"amount_without_vat" numeric(12, 2),
	"description" text,
	"file_url" varchar(1024),
	"file_name" varchar(255),
	"file_hash" varchar(64),
	"page_count" integer,
	"extracted_text" text,
	"extraction_method" text,
	"extraction_confidence" numeric(3, 2),
	"needs_review" boolean DEFAULT false,
	"review_notes" text,
	"rejection_reason" text,
	"added_month" varchar(7),
	"llm_input_tokens" integer DEFAULT 0,
	"llm_output_tokens" integer DEFAULT 0,
	"llm_cost_usd" numeric(10, 6) DEFAULT '0',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"is_locked" boolean DEFAULT false,
	"locked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user_email_funnel_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"funnel_id" uuid NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"entered_at" timestamp DEFAULT now(),
	"last_step_at" timestamp,
	"next_email_at" timestamp,
	"exit_reason" varchar(255),
	"exited_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_email_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"unsubscribed_all" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_email_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_email_funnel_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"funnel_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"from_step" integer,
	"to_step" integer,
	"target_funnel_id" uuid,
	"reason" varchar(255),
	"details" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pricing_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"max_invoices_per_month" integer NOT NULL,
	"price_monthly" numeric(10, 2) NOT NULL,
	"price_yearly" numeric(10, 2),
	"stripe_price_id_monthly" varchar(255),
	"stripe_price_id_yearly" varchar(255),
	"features" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "pricing_tiers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pricing_tier_id" uuid NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"status" varchar(20) DEFAULT 'free' NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"canceled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_subscriptions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "usage_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"year_month" varchar(7) NOT NULL,
	"invoice_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) DEFAULT 'Default' NOT NULL,
	"design_id" text DEFAULT 'classic' NOT NULL,
	"accent_color" varchar(7) DEFAULT '#6366f1',
	"logo_url" varchar(1024),
	"business_name" varchar(255),
	"business_address" text,
	"business_phone" varchar(50),
	"business_email" varchar(255),
	"business_tax_id" varchar(100),
	"business_website" varchar(512),
	"show_vat_breakdown" boolean DEFAULT true,
	"default_currency" varchar(3) DEFAULT 'ILS',
	"default_language" varchar(5) DEFAULT 'he',
	"is_default" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rbac_denials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"business_entity_id" uuid,
	"permission" text NOT NULL,
	"reason" text NOT NULL,
	"route" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" text NOT NULL,
	"algorithm" "signing_key_algorithm" NOT NULL,
	"public_key_pem" text NOT NULL,
	"certificate_pem" text,
	"subject" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"status" "signing_key_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "signing_keys_key_id_unique" UNIQUE("key_id")
);
--> statement-breakpoint
CREATE TABLE "shaam_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"environment" "shaam_environment" NOT NULL,
	"status" "shaam_authorization_status" DEFAULT 'PENDING' NOT NULL,
	"refresh_token_encrypted" text,
	"refresh_token_iv" text,
	"refresh_token_tag" text,
	"refresh_token_expires_at" timestamp with time zone,
	"access_token_encrypted" text,
	"access_token_iv" text,
	"access_token_tag" text,
	"access_token_expires_at" timestamp with time zone,
	"scope" text,
	"authorized_at" timestamp with time zone,
	"last_refreshed_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shaam_authorizations_entity_env_unique" UNIQUE("business_entity_id","environment")
);
--> statement-breakpoint
CREATE TABLE "shaam_token_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"environment" "shaam_environment" NOT NULL,
	"event_type" "shaam_token_event_type" NOT NULL,
	"http_status" integer,
	"error_code" text,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shaam_authorization_pending" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"environment" "shaam_environment" NOT NULL,
	"state" text NOT NULL,
	"code_verifier" text NOT NULL,
	"initiated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shaam_authorization_pending_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "shaam_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"environment" "shaam_environment" NOT NULL,
	"action_code" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_payload" jsonb NOT NULL,
	"request_payload_hash" text NOT NULL,
	"response_payload" jsonb,
	"response_http_status" integer,
	"response_allocation_number" text,
	"response_status" "shaam_response_status",
	"response_error_code" text,
	"response_error_message" text,
	"request_id" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"duration_ms" integer,
	CONSTRAINT "shaam_submissions_idempotency_unique" UNIQUE("idempotency_key","environment")
);
--> statement-breakpoint
CREATE TABLE "shaam_tenant_readiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"azor_ishi_confirmed" boolean DEFAULT false NOT NULL,
	"taagid_registered" boolean DEFAULT false NOT NULL,
	"morshe_al_assigned" boolean DEFAULT false NOT NULL,
	"osek_murshe_present" boolean DEFAULT false NOT NULL,
	"last_confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"support_contact_email" text,
	"support_contact_phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shaam_tenant_readiness_business_entity_id_unique" UNIQUE("business_entity_id")
);
--> statement-breakpoint
CREATE TABLE "notification_sent_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"notification_kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"recipient_email" text,
	"ses_message_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_sent_log_unique" UNIQUE("business_entity_id","notification_kind","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "uniform_structure_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"stats" jsonb,
	"s3_key_ini" text,
	"s3_key_bkmvdata" text,
	"s3_key_zip" text,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniform_structure_exports_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "outbound_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_entity_id" uuid NOT NULL,
	"template_id" uuid,
	"customer_id" uuid,
	"invoice_number" varchar(100) NOT NULL,
	"document_type" "document_type" DEFAULT 'TAX_INVOICE' NOT NULL,
	"tax_year" integer NOT NULL,
	"sequence_number" bigint NOT NULL,
	"formatted_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '18',
	"vat_amount" numeric(12, 2),
	"total" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'ILS',
	"language" varchar(5) DEFAULT 'he',
	"notes" text,
	"references_document_id" uuid,
	"net_of_credits_amount" numeric(14, 2),
	"status" text DEFAULT 'draft',
	"pdf_url" varchar(1024),
	"sent_at" timestamp with time zone,
	"shaam_status" text DEFAULT 'NOT_APPLICABLE' NOT NULL,
	"allocation_number" text,
	"shaam_submitted_at" timestamp with time zone,
	"shaam_response_at" timestamp with time zone,
	"shaam_action_code" integer,
	"shaam_idempotency_key" text,
	"shaam_request_id" text,
	"shaam_last_error_code" text,
	"shaam_last_error_message" text,
	"shaam_retry_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "outbound_invoices_user_type_year_seq_unique" UNIQUE("user_id","document_type","tax_year","sequence_number")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" varchar(64) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_response_status" integer,
	"last_response_snippet" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"url" varchar(2048) NOT NULL,
	"description" varchar(500),
	"events" text[] NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_iv" varchar(64) NOT NULL,
	"secret_tag" varchar(64) NOT NULL,
	"secret_hint" varchar(12) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_delivery_at" timestamp,
	"last_success_at" timestamp,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp,
	"disabled_reason" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "upload_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"api_key_id" uuid,
	"file_key" text NOT NULL,
	"file_name" varchar(512) NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"hint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'awaiting_upload' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"invoice_id" uuid,
	"error_code" varchar(100),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_managed_user_id_users_id_fk" FOREIGN KEY ("managed_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_objects" ADD CONSTRAINT "archive_objects_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_objects" ADD CONSTRAINT "archive_objects_stored_by_user_id_users_id_fk" FOREIGN KEY ("stored_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_entities" ADD CONSTRAINT "business_entities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_entity_members" ADD CONSTRAINT "business_entity_members_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_entity_members" ADD CONSTRAINT "business_entity_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissed_duplicate_pairs" ADD CONSTRAINT "dismissed_duplicate_pairs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissed_duplicate_pairs" ADD CONSTRAINT "dismissed_duplicate_pairs_invoice_id_a_invoices_id_fk" FOREIGN KEY ("invoice_id_a") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissed_duplicate_pairs" ADD CONSTRAINT "dismissed_duplicate_pairs_invoice_id_b_invoices_id_fk" FOREIGN KEY ("invoice_id_b") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_audit_log" ADD CONSTRAINT "document_audit_log_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_audit_log" ADD CONSTRAINT "document_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_audit_log" ADD CONSTRAINT "document_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_from_document_id_outbound_invoices_id_fk" FOREIGN KEY ("from_document_id") REFERENCES "public"."outbound_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_to_document_id_outbound_invoices_id_fk" FOREIGN KEY ("to_document_id") REFERENCES "public"."outbound_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_number_sequences" ADD CONSTRAINT "document_number_sequences_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_number_sequences" ADD CONSTRAINT "document_number_sequences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_document_id_outbound_invoices_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."outbound_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_key_id_signing_keys_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."signing_keys"("key_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_funnel_exits" ADD CONSTRAINT "email_funnel_exits_funnel_id_email_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."email_funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_funnel_steps" ADD CONSTRAINT "email_funnel_steps_funnel_id_email_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."email_funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_funnel_steps" ADD CONSTRAINT "email_funnel_steps_email_template_id_email_templates_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_clicks" ADD CONSTRAINT "email_clicks_email_log_id_email_logs_id_fk" FOREIGN KEY ("email_log_id") REFERENCES "public"."email_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_email_template_id_email_templates_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_email_funnel_id_email_funnels_id_fk" FOREIGN KEY ("email_funnel_id") REFERENCES "public"."email_funnels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_rules" ADD CONSTRAINT "extraction_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_rules" ADD CONSTRAINT "extraction_rules_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_email_log" ADD CONSTRAINT "inbound_email_log_matched_user_id_users_id_fk" FOREIGN KEY ("matched_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_email_funnel_states" ADD CONSTRAINT "user_email_funnel_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_email_funnel_states" ADD CONSTRAINT "user_email_funnel_states_funnel_id_email_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."email_funnels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_email_preferences" ADD CONSTRAINT "user_email_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_email_funnel_history" ADD CONSTRAINT "user_email_funnel_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_email_funnel_history" ADD CONSTRAINT "user_email_funnel_history_funnel_id_email_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."email_funnels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_pricing_tier_id_pricing_tiers_id_fk" FOREIGN KEY ("pricing_tier_id") REFERENCES "public"."pricing_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_tracking" ADD CONSTRAINT "usage_tracking_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shaam_authorizations" ADD CONSTRAINT "shaam_authorizations_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shaam_token_events" ADD CONSTRAINT "shaam_token_events_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shaam_authorization_pending" ADD CONSTRAINT "shaam_authorization_pending_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shaam_submissions" ADD CONSTRAINT "shaam_submissions_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shaam_tenant_readiness" ADD CONSTRAINT "shaam_tenant_readiness_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shaam_tenant_readiness" ADD CONSTRAINT "shaam_tenant_readiness_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_sent_log" ADD CONSTRAINT "notification_sent_log_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uniform_structure_exports" ADD CONSTRAINT "uniform_structure_exports_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uniform_structure_exports" ADD CONSTRAINT "uniform_structure_exports_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_invoices" ADD CONSTRAINT "outbound_invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_invoices" ADD CONSTRAINT "outbound_invoices_business_entity_id_business_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."business_entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_invoices" ADD CONSTRAINT "outbound_invoices_template_id_invoice_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."invoice_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_invoices" ADD CONSTRAINT "outbound_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_invoices" ADD CONSTRAINT "outbound_invoices_references_document_id_outbound_invoices_id_fk" FOREIGN KEY ("references_document_id") REFERENCES "public"."outbound_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_invoices" ADD CONSTRAINT "outbound_invoices_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD CONSTRAINT "upload_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD CONSTRAINT "upload_jobs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD CONSTRAINT "upload_jobs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_links_manager_managed_idx" ON "account_links" USING btree ("manager_user_id","managed_user_id");--> statement-breakpoint
CREATE INDEX "api_idem_created_idx" ON "api_idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_public_id_idx" ON "api_keys" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "archive_objects_document_kind_idx" ON "archive_objects" USING btree ("document_id","object_kind");--> statement-breakpoint
CREATE INDEX "archive_objects_bucket_key_idx" ON "archive_objects" USING btree ("s3_bucket","s3_key");--> statement-breakpoint
CREATE INDEX "archive_objects_business_entity_stored_at_idx" ON "archive_objects" USING btree ("business_entity_id","stored_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_user_id_name_idx" ON "customers" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "dismissed_duplicate_pairs_user_pair_idx" ON "dismissed_duplicate_pairs" USING btree ("user_id","invoice_id_a","invoice_id_b");--> statement-breakpoint
CREATE INDEX "dismissed_duplicate_pairs_user_idx" ON "dismissed_duplicate_pairs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_audit_log_business_entity_created_at_idx" ON "document_audit_log" USING btree ("business_entity_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "document_audit_log_user_id_created_at_idx" ON "document_audit_log" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "document_audit_log_document_id_idx" ON "document_audit_log" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_links_from_type_idx" ON "document_links" USING btree ("from_document_id","link_type");--> statement-breakpoint
CREATE INDEX "document_links_to_type_idx" ON "document_links" USING btree ("to_document_id","link_type");--> statement-breakpoint
CREATE INDEX "document_number_sequences_business_entity_id_idx" ON "document_number_sequences" USING btree ("business_entity_id");--> statement-breakpoint
CREATE INDEX "document_number_sequences_user_id_idx" ON "document_number_sequences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_signatures_business_entity_id_idx" ON "document_signatures" USING btree ("business_entity_id");--> statement-breakpoint
CREATE INDEX "document_signatures_key_id_idx" ON "document_signatures" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_funnel_steps_funnel_step_idx" ON "email_funnel_steps" USING btree ("funnel_id","step_number");--> statement-breakpoint
CREATE INDEX "email_logs_ses_message_id_idx" ON "email_logs" USING btree ("ses_message_id");--> statement-breakpoint
CREATE INDEX "email_logs_user_id_idx" ON "email_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inbound_email_log_matched_user_idx" ON "inbound_email_log" USING btree ("matched_user_id");--> statement-breakpoint
CREATE INDEX "inbound_email_log_received_at_idx" ON "inbound_email_log" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "inbound_email_log_outcome_idx" ON "inbound_email_log" USING btree ("outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_user_id_name_idx" ON "vendors" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_user_id_file_hash_idx" ON "invoices" USING btree ("user_id","file_hash");--> statement-breakpoint
CREATE INDEX "invoices_user_id_invoice_date_idx" ON "invoices" USING btree ("user_id","invoice_date");--> statement-breakpoint
CREATE UNIQUE INDEX "periods_user_id_year_month_idx" ON "periods" USING btree ("user_id","year","month");--> statement-breakpoint
CREATE INDEX "uefs_user_status_idx" ON "user_email_funnel_states" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "uefs_status_next_email_idx" ON "user_email_funnel_states" USING btree ("status","next_email_at");--> statement-breakpoint
CREATE INDEX "uefh_user_funnel_idx" ON "user_email_funnel_history" USING btree ("user_id","funnel_id");--> statement-breakpoint
CREATE INDEX "user_sub_stripe_customer_idx" ON "user_subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "user_sub_stripe_subscription_idx" ON "user_subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_tracking_user_month_idx" ON "usage_tracking" USING btree ("user_id","year_month");--> statement-breakpoint
CREATE INDEX "rbac_denials_user_id_created_at_idx" ON "rbac_denials" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "signing_keys_active_idx" ON "signing_keys" USING btree ("key_id") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "shaam_authorizations_status_refresh_idx" ON "shaam_authorizations" USING btree ("status","refresh_token_expires_at");--> statement-breakpoint
CREATE INDEX "shaam_token_events_entity_created_at_idx" ON "shaam_token_events" USING btree ("business_entity_id","created_at");--> statement-breakpoint
CREATE INDEX "shaam_authorization_pending_expires_at_idx" ON "shaam_authorization_pending" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "shaam_submissions_document_submitted_at_idx" ON "shaam_submissions" USING btree ("document_id","submitted_at");--> statement-breakpoint
CREATE INDEX "shaam_submissions_entity_submitted_at_idx" ON "shaam_submissions" USING btree ("business_entity_id","submitted_at");--> statement-breakpoint
CREATE INDEX "notification_sent_log_kind_sent_idx" ON "notification_sent_log" USING btree ("notification_kind","sent_at");--> statement-breakpoint
CREATE INDEX "uniform_structure_exports_entity_created_at_idx" ON "uniform_structure_exports" USING btree ("business_entity_id","created_at");--> statement-breakpoint
CREATE INDEX "uniform_structure_exports_status_idx" ON "uniform_structure_exports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outbound_invoices_user_id_date_idx" ON "outbound_invoices" USING btree ("user_id","invoice_date");--> statement-breakpoint
CREATE INDEX "outbound_invoices_business_entity_id_idx" ON "outbound_invoices" USING btree ("business_entity_id");--> statement-breakpoint
CREATE INDEX "outbound_invoices_user_type_year_idx" ON "outbound_invoices" USING btree ("user_id","document_type","tax_year");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_user_idx" ON "webhook_endpoints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upload_jobs_user_idx" ON "upload_jobs" USING btree ("user_id","created_at");