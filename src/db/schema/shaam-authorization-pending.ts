import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { businessEntities } from "./business-entities";
import { shaamEnvironmentEnum } from "./shaam-authorizations";

/**
 * Short-lived pending-state row for the OAuth dance. Written by
 * `initiateAuthorization`, consumed by the `/api/shaam/oauth/callback`
 * route, then deleted. Rows older than ~15 minutes are stale and swept
 * by the nightly expire-scan cron.
 *
 * The `state` column is the OAuth state parameter and is opaque to the
 * ITA — lookups join on it; we don't expose the businessEntityId in
 * the authorize URL so an attacker can't forge a callback for an
 * arbitrary tenant.
 *
 * `codeVerifier` is the PKCE verifier; it's not secret per RFC 7636
 * but we store it server-side so the browser round trip can't tamper
 * with it.
 */
export const shaamAuthorizationPending = pgTable(
  "shaam_authorization_pending",
  {
    id: uuid().primaryKey().defaultRandom(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    environment: shaamEnvironmentEnum("environment").notNull(),
    state: text("state").notNull().unique(),
    codeVerifier: text("code_verifier").notNull(),
    initiatedByUserId: uuid("initiated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("shaam_authorization_pending_expires_at_idx").on(table.expiresAt),
  ],
);

export const shaamAuthorizationPendingRelations = relations(
  shaamAuthorizationPending,
  ({ one }) => ({
    businessEntity: one(businessEntities, {
      fields: [shaamAuthorizationPending.businessEntityId],
      references: [businessEntities.id],
    }),
  }),
);
