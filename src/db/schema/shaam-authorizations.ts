import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { businessEntities } from "./business-entities";

export const SHAAM_ENVIRONMENTS = ["UAT", "PROD"] as const;
export type ShaamEnvironment = (typeof SHAAM_ENVIRONMENTS)[number];
export const shaamEnvironmentEnum = pgEnum(
  "shaam_environment",
  SHAAM_ENVIRONMENTS,
);

export const SHAAM_AUTHORIZATION_STATUSES = [
  "PENDING",
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "ERROR",
] as const;
export type ShaamAuthorizationStatus =
  (typeof SHAAM_AUTHORIZATION_STATUSES)[number];
export const shaamAuthorizationStatusEnum = pgEnum(
  "shaam_authorization_status",
  SHAAM_AUTHORIZATION_STATUSES,
);

/**
 * One row per (business_entity, environment). Holds the encrypted
 * refresh/access tokens InvoLoops uses to call SHAAM on behalf of the
 * business entity. The refresh token expiry is the hard edge — if it
 * elapses without rotation, the business must re-authorise via
 * gov.il's "הרשאה לפעולות דיגיטליות" flow.
 *
 * Crypto: AES-256-GCM. Key derived from SHAAM_TOKEN_ENCRYPTION_SECRET
 * (with AUTH_SECRET + "shaam-tokens:" salt as fallback). The
 * ciphertext/IV/tag triplets are opaque strings here; encryption and
 * decryption are handled by `src/lib/shaam/token-crypto.ts`.
 */
export const shaamAuthorizations = pgTable(
  "shaam_authorizations",
  {
    id: uuid().primaryKey().defaultRandom(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    environment: shaamEnvironmentEnum("environment").notNull(),
    status: shaamAuthorizationStatusEnum("status").notNull().default("PENDING"),

    refreshTokenEncrypted: text("refresh_token_encrypted"),
    refreshTokenIv: text("refresh_token_iv"),
    refreshTokenTag: text("refresh_token_tag"),
    /** 90 days from first grant; rotated by successful refresh responses. */
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),

    accessTokenEncrypted: text("access_token_encrypted"),
    accessTokenIv: text("access_token_iv"),
    accessTokenTag: text("access_token_tag"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),

    scope: text("scope"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("shaam_authorizations_entity_env_unique").on(
      table.businessEntityId,
      table.environment,
    ),
    index("shaam_authorizations_status_refresh_idx").on(
      table.status,
      table.refreshTokenExpiresAt,
    ),
  ],
);

export const shaamAuthorizationsRelations = relations(
  shaamAuthorizations,
  ({ one }) => ({
    businessEntity: one(businessEntities, {
      fields: [shaamAuthorizations.businessEntityId],
      references: [businessEntities.id],
    }),
  }),
);
