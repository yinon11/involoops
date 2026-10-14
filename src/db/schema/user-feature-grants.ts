import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Per-user feature entitlement. Layers *on top of* what the user's pricing
 * tier already grants — see `src/lib/features/`.
 *
 * The catalogue of valid `feature` strings lives in code
 * (`src/lib/features/registry.ts`) so adding a feature is a typed code
 * change and never a migration; this table just records who has been
 * granted what.
 *
 * Lifecycle columns:
 *   - `expiresAt` NULL  -> permanent grant (typical for staff, beta access).
 *   - `expiresAt` set   -> auto-revokes at that time without any cron
 *                          (the resolver filters it out). Use for trials
 *                          or contract-bound access.
 *   - `revokedAt` set   -> manual revoke. Kept (not deleted) for audit; the
 *                          partial unique index excludes revoked rows so a
 *                          fresh grant can be re-issued cleanly.
 *
 * `grantedBy` is the admin (or system actor) that issued the grant; nullable
 * so seeded / migration-time grants don't need a synthetic user row.
 */
export const userFeatureGrants = pgTable(
  "user_feature_grants",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Must match a value in `src/lib/features/registry.ts#FEATURES`. */
    feature: varchar({ length: 64 }).notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    /** NULL = permanent. Non-null = trial / contract end. */
    expiresAt: timestamp("expires_at"),
    /** Free-form note for audit ("Beta cohort 2026-Q2", "Comp for outage"). */
    reason: text(),
    /** Soft-revoke. Row is kept for audit; resolver ignores it. */
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    /**
     * One *active* grant per (user, feature). Re-granting after revoke is
     * fine because revoked rows are excluded from the index.
     */
    uniqueIndex("user_feature_grants_user_feature_active_unique")
      .on(t.userId, t.feature)
      .where(sql`revoked_at IS NULL`),
  ],
);

export const userFeatureGrantsRelations = relations(
  userFeatureGrants,
  ({ one }) => ({
    user: one(users, {
      fields: [userFeatureGrants.userId],
      references: [users.id],
      relationName: "userFeatureGrants_user",
    }),
    grantedByUser: one(users, {
      fields: [userFeatureGrants.grantedBy],
      references: [users.id],
      relationName: "userFeatureGrants_grantedBy",
    }),
  }),
);
