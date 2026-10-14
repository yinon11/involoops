import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

/**
 * A signed-in phone. The refresh token is stored only as an HMAC.
 * The access token is a short-lived JWT and is not stored.
 */
export const deviceSessions = pgTable(
  "device_sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceName: varchar("device_name", { length: 120 }).notNull(),
    refreshTokenHash: varchar("refresh_token_hash", { length: 128 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdByIp: varchar("created_by_ip", { length: 64 }),
    lastUsedAt: timestamp("last_used_at"),
    lastUsedIp: varchar("last_used_ip", { length: 64 }),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    index("device_sessions_user_idx").on(table.userId),
    uniqueIndex("device_sessions_refresh_hash_idx").on(table.refreshTokenHash),
  ],
);

export const deviceSessionsRelations = relations(deviceSessions, ({ one }) => ({
  user: one(users, {
    fields: [deviceSessions.userId],
    references: [users.id],
  }),
}));

export type DeviceSessionRow = typeof deviceSessions.$inferSelect;
