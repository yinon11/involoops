import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

/**
 * Replay store for `Idempotency-Key` headers on the public API.
 *
 * Lookup is by (api_key_id, key). On a body-fingerprint match within the
 * 24-hour window we replay `status` + `body` verbatim. Mismatched bodies
 * for the same key return 409 (see docs/api/02-conventions.md).
 *
 * 5xx responses are NOT stored — the next attempt should retry, not replay
 * a server failure. A daily cron evicts rows older than 24h.
 */
export const apiIdempotencyKeys = pgTable(
  "api_idempotency_keys",
  {
    apiKeyId: uuid("api_key_id").notNull(),
    key: varchar({ length: 255 }).notNull(),
    /** sha256(method + " " + path + " " + canonical_json(body)). */
    fingerprint: varchar({ length: 64 }).notNull(),
    status: integer().notNull(),
    body: jsonb().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.apiKeyId, table.key] }),
    index("api_idem_created_idx").on(table.createdAt),
  ],
);
