import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * Append-only log of errors reported through `reportError()`.
 *
 * - `key` is the short identifier the caller passes (e.g. `"vision_api_error"`);
 *   the policy registry in `src/lib/error-reporter/policies.ts` maps each key
 *   to `immediate` / `digest` / `ignore`.
 * - `fingerprint = sha1(key + ":" + normalize(message))` groups recurring
 *   errors so we can rate-limit immediate sends and collapse digest rows.
 * - `sent_at IS NULL` means the row is still queued for the daily digest;
 *   immediate sends set it at insert time. Errors with policy `ignore` are
 *   not written at all.
 */
export const errorEvents = pgTable(
  "error_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    key: text("key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    message: text("message").notNull(),
    stack: text("stack"),
    context: jsonb("context").$type<Record<string, unknown>>(),
    policy: text("policy").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("error_events_pending_idx").on(table.sentAt, table.createdAt),
    index("error_events_fingerprint_idx").on(table.fingerprint, table.createdAt),
  ],
);

export type ErrorEvent = typeof errorEvents.$inferSelect;
export type NewErrorEvent = typeof errorEvents.$inferInsert;
