import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

/**
 * Public-API bearer keys ("inv_live_..." / "inv_test_...").
 *
 * The full token is shown to the user once at creation — only the public
 * id half is stored unhashed (used to look up the row in O(1)). The secret
 * half is stored as `HMAC-SHA-256(secret, API_KEY_PEPPER)`; comparison
 * uses `crypto.timingSafeEqual`. See docs/api/01-auth-and-api-keys.md.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** User-chosen label. Shown in the dashboard. */
    name: varchar({ length: 120 }).notNull(),
    /** 28-char base62 segment before the dot. Indexed for lookup. */
    publicId: varchar("public_id", { length: 64 }).notNull(),
    /** Hex of HMAC-SHA-256(secret, pepper). Never a plaintext secret. */
    secretHash: varchar("secret_hash", { length: 128 }).notNull(),
    /** "live" or "test". Test keys can never call SHAAM live or send real email. */
    mode: varchar({ length: 8 }).notNull(),
    /** Granted scopes (see SCOPES in src/lib/api/scopes.ts). */
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdByIp: varchar("created_by_ip", { length: 64 }),
    /** Updated at most once/min per key (debounced). NULL = never used. */
    lastUsedAt: timestamp("last_used_at"),
    lastUsedIp: varchar("last_used_ip", { length: 64 }),
    /** Optional expiry. NULL = no expiry. */
    expiresAt: timestamp("expires_at"),
    /** Set when revoked. The auth path treats NOT NULL as "rejected". */
    revokedAt: timestamp("revoked_at"),
    revokedReason: varchar("revoked_reason", { length: 255 }),
  },
  (table) => [
    uniqueIndex("api_keys_public_id_idx").on(table.publicId),
    index("api_keys_user_idx").on(table.userId),
  ],
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

export type ApiKeyMode = "live" | "test";

export type ApiKeyRow = typeof apiKeys.$inferSelect;
