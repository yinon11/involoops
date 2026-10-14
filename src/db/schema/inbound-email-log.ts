import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Audit trail for every inbound email the Gmail webhook processes. Captures
 * both accepted messages (invoice added) and all failure modes:
 * `unknown_sender`, `dkim_fail`, `over_limit`, `no_attachment`, `error`.
 *
 * `gmailMessageId` is UNIQUE so Pub/Sub replays of the same notification
 * insert at most once — we rely on this as our dedup guard on the webhook.
 * The row is inserted as an atomic claim (outcome "processing") BEFORE the
 * pipeline runs, then updated in place with the final outcome.
 *
 * `matchedUserId` uses ON DELETE SET NULL so user deletion does not erase
 * historical inbound metadata; this log is platform-level audit data.
 *
 * `invoiceIds` is an array because one email can produce multiple invoice
 * rows (ZIP attachment, or several PDFs attached). Empty when the email
 * wasn't accepted.
 */
export const inboundEmailLog = pgTable(
  "inbound_email_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    gmailMessageId: varchar("gmail_message_id", { length: 128 })
      .notNull()
      .unique(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    fromAddress: varchar("from_address", { length: 320 }),
    toAddress: varchar("to_address", { length: 320 }),
    subject: text(),
    dkimPass: boolean("dkim_pass"),
    matchedUserId: uuid("matched_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Short string tag. Kept unconstrained for now so we can evolve the
     * set without a migration; a CHECK can be added once stable. Current
     * values: processing | accepted | unknown_sender | dkim_fail |
     * over_limit | no_attachment | no_valid_attachment | duplicate |
     * error. "processing" is the transient claim state written before
     * the pipeline runs (see process-message.ts); rows normally leave it
     * within seconds.
     */
    outcome: varchar({ length: 32 }).notNull(),
    errorMessage: text("error_message"),
    invoiceIds: uuid("invoice_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
  },
  (table) => [
    index("inbound_email_log_matched_user_idx").on(table.matchedUserId),
    index("inbound_email_log_received_at_idx").on(table.receivedAt),
    index("inbound_email_log_outcome_idx").on(table.outcome),
  ],
);
