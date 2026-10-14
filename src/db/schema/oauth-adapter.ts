import {
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
  index,
} from "drizzle-orm/pg-core";

/**
 * Opaque oidc-provider state (authorization codes, access tokens, refresh
 * tokens, grants, sessions, interactions). The token value is the row id —
 * the same layout the library's adapters use. Not a JWT store.
 */
export const oauthAdapterPayloads = pgTable(
  "oauth_adapter_payloads",
  {
    model: varchar({ length: 64 }).notNull(),
    id: text().notNull(),
    payload: jsonb().notNull(),
    grantId: text("grant_id"),
    userCode: text("user_code"),
    uid: text(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.model, table.id] }),
    index("oauth_adapter_grant_idx").on(table.model, table.grantId),
    index("oauth_adapter_uid_idx").on(table.model, table.uid),
    index("oauth_adapter_user_code_idx").on(table.model, table.userCode),
  ],
);
