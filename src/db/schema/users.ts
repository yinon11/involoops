import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  boolean,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).unique().notNull(),
  name: varchar({ length: 255 }),
  /** Shown in the app header, e.g. "InvoLoops" → "⚡ InvoLoops" */
  companyName: varchar("company_name", { length: 255 }),
  /**
   * Preferred display currency for dashboard aggregates (ISO 4217, upper case).
   * NULL = fall back to DEFAULT_DISPLAY_CURRENCY env var, then 'ILS'.
   */
  displayCurrency: varchar("display_currency", { length: 3 }),
  /**
   * Preferred UI locale (e.g. "en", "he"). NULL means the user has not made an
   * explicit choice yet — the resolver falls back to geo/Accept-Language.
   * Written either when the user clicks the header picker while signed in, or
   * once on first sign-in if they already picked as an anon visitor (or from
   * CF-IPCountry / Accept-Language otherwise).
   */
  preferredLocale: varchar("preferred_locale", { length: 8 }),
  passwordHash: varchar("password_hash", { length: 255 }),
  isAdmin: boolean("is_admin").default(false).notNull(),
  /**
   * Per-user override for the per-link `account_links.auto_act_as` flow.
   * When true (default), a manager with exactly one linked managed account
   * is auto-switched into it on sign-in. When false, the manager stays on
   * their own account regardless of the link's flag — useful for platform
   * admins. Toggled from Settings → General.
   */
  autoActAsManagedAccounts: boolean("auto_act_as_managed_accounts")
    .default(true)
    .notNull(),
  /**
   * Per-user Anthropic (Claude) API key — stored as AES-256-GCM ciphertext.
   * NEVER stored in plaintext. All four of ciphertext, iv, tag and
   * validated_at must be non-null for a user to be considered BYOK; tier
   * resolution checks this server-side on every request so a client cannot
   * claim the BYOK / Enterprise tier without a verified key.
   */
  anthropicApiKeyCiphertext: text("anthropic_api_key_ciphertext"),
  anthropicApiKeyIv: varchar("anthropic_api_key_iv", { length: 64 }),
  anthropicApiKeyTag: varchar("anthropic_api_key_tag", { length: 64 }),
  /** Last 4 chars for UI display ("...abcd"). Safe to expose. */
  anthropicApiKeyHint: varchar("anthropic_api_key_hint", { length: 12 }),
  /** Set when the key passed a live Anthropic probe at save time. */
  anthropicApiKeyValidatedAt: timestamp("anthropic_api_key_validated_at"),
  /**
   * Per-user alias for the Gmail-forwarding invoice intake. When set, the
   * user can forward invoices to `<invoice_alias>@involoops.com` and the
   * webhook will route them into this account. NULL until the user
   * generates one from the UI. Unique among non-null values; see migration
   * 0014 for the partial unique index.
   */
  invoiceAlias: varchar("invoice_alias", { length: 64 }),
  /**
   * Whether the user has opted in to receive marketing emails. Captured at
   * signup; intended to grow into multiple granular categories later, so any
   * new marketing channel should add its own column rather than overloading
   * this one.
   */
  marketingOptIn: boolean("marketing_opt_in").default(false).notNull(),
  /** Timestamp of the latest opt-in/out change, for auditability. */
  marketingOptInAt: timestamp("marketing_opt_in_at"),
  /**
   * The user objected to their figures being used to choose sponsored
   * offers. They then see only campaigns shown to everyone.
   * Settings → Data; see the Privacy Policy, "Your Rights".
   */
  sponsorTargetingOptOut: boolean("sponsor_targeting_opt_out")
    .default(false)
    .notNull(),
  /** When the user last changed `sponsorTargetingOptOut`. */
  sponsorTargetingOptOutAt: timestamp("sponsor_targeting_opt_out_at"),
  /**
   * Hide the "approved with no changes — auto-approve future invoices from
   * this vendor?" prompt that fires after pending review when the user did
   * not edit any extracted fields. Flipped via the dialog's "don't show
   * again" checkbox or the matching toggle on Settings → Invoices.
   */
  suppressAutoApprovePrompt: boolean("suppress_auto_approve_prompt")
    .default(false)
    .notNull(),
  /**
   * TOTP multi-factor authentication. `mfaEnabled` is the authoritative flag —
   * flipped to true only after the user proves they can generate a valid code
   * during enrollment. The shared secret is stored as AES-256-GCM ciphertext
   * (never plaintext) and keyed with HKDF(AUTH_SECRET), mirroring the Anthropic
   * key pattern. Backup codes are bcrypt-hashed; entries are removed on use.
   */
  mfaEnabled: boolean("mfa_enabled").default(false).notNull(),
  mfaSecretCiphertext: text("mfa_secret_ciphertext"),
  mfaSecretIv: varchar("mfa_secret_iv", { length: 64 }),
  mfaSecretTag: varchar("mfa_secret_tag", { length: 64 }),
  mfaEnabledAt: timestamp("mfa_enabled_at"),
  mfaBackupCodes: jsonb("mfa_backup_codes").$type<string[]>(),
  /**
   * GDPR soft-delete. When `deletionRequestedAt` is set the user has asked
   * to be erased; they can still sign in and use the app (with a visible
   * warning banner) and may cancel the request until `deletionScheduledFor`
   * passes. A daily cron at `/api/cron/purge-scheduled-deletions` is the
   * only writer that actually removes the row.
   */
  deletionRequestedAt: timestamp("deletion_requested_at"),
  deletionScheduledFor: timestamp("deletion_scheduled_for"),
  /**
   * Onboarding wizard state. `onboardingCompleted` is the gate the app
   * layout uses to redirect new users to `/welcome`; `onboardingStep`
   * records the highest step the user has reached so the wizard can
   * resume mid-flow. `businessType` captures the freelancer vs.
   * small_business answer from step 1 — used later for tailored
   * defaults in the home/dashboard.
   */
  onboardingCompleted: boolean("onboarding_completed")
    .default(false)
    .notNull(),
  onboardingStep: integer("onboarding_step").default(0).notNull(),
  businessType: text("business_type"),
  /**
   * Per-account override for the outbound-document daily cap: how many
   * documents may be issued to a single customer within one Israel
   * calendar day. NULL (the default for every account) means "use
   * `DEFAULT_MAX_OUTBOUND_DOCS_PER_CUSTOMER_PER_DAY`" — the fallback
   * lives in code, not in a column default, so raising the product-wide
   * limit is a one-line change that needs no migration and no backfill.
   *
   * Read through `resolveOutboundCustomerDailyLimit`, which resolves this
   * from the business entity's OWNER, never from the acting user — an
   * accountant acting-as must get the owner's limit.
   */
  maxOutboundInvoicesPerCustomerPerDay: integer(
    "max_outbound_invoices_per_customer_per_day",
  ),
  createdAt: timestamp("created_at").defaultNow(),
  emailVerified: timestamp("email_verified"),
  image: text(),
});
