import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { businessEntities } from "./business-entities";

/**
 * Spec 09 — small append-only log used for notification
 * deduplication. Keyed on `(business_entity, notification_kind,
 * dedupe_key)` so two cron runs on the same day can't double-send
 * the same nudge (e.g. "expires in 14 days — 2026-04-20" gets
 * written once, checked on subsequent invocations).
 *
 * Not a rich email log (that already exists in `email_logs` for
 * funnel sends) — just a dedup fingerprint table.
 */
export const notificationSentLog = pgTable(
  "notification_sent_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    notificationKind: text("notification_kind").notNull(),
    /** e.g. `expiry-14d-2026-04-20` — uniquely identifies the nudge */
    dedupeKey: text("dedupe_key").notNull(),
    recipientEmail: text("recipient_email"),
    sesMessageId: text("ses_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("notification_sent_log_unique").on(
      table.businessEntityId,
      table.notificationKind,
      table.dedupeKey,
    ),
    index("notification_sent_log_kind_sent_idx").on(
      table.notificationKind,
      table.sentAt,
    ),
  ],
);
