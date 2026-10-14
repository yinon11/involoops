import {
  pgTable,
  serial,
  varchar,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Runtime state for Gmail push notifications. One row per mailbox we watch.
 *
 * - `lastHistoryId`: checkpoint for `users.history.list(startHistoryId=...)`.
 *   Updated after each successful webhook delivery.
 * - `watchExpiresAt`: Gmail `watch()` subscriptions expire after 7 days; a
 *   daily cron renews before expiry and updates this column.
 *
 * Currently there is only one mailbox, from GMAIL_INBOX_ADDRESS. The table is
 * keyed by email so adding per-tenant inboxes later is a row insert, not a
 * migration.
 */
export const gmailWatchState = pgTable("gmail_watch_state", {
  id: serial().primaryKey(),
  mailboxEmail: varchar("mailbox_email", { length: 255 }).notNull().unique(),
  lastHistoryId: varchar("last_history_id", { length: 64 }),
  watchExpiresAt: timestamp("watch_expires_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
