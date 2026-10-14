import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { invoices } from "./invoices";

/**
 * Pairs of invoices the user has explicitly confirmed are NOT duplicates of
 * each other. Used to suppress known-false-positive groups on the Duplicates
 * page while still surfacing any *new* invoice that joins the same group
 * later (since only the old pair is dismissed, not the new one).
 *
 * Pairs are stored canonicalised with invoice_id_a < invoice_id_b so each
 * unordered pair has exactly one row.
 */
export const dismissedDuplicatePairs = pgTable(
  "dismissed_duplicate_pairs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invoiceIdA: uuid("invoice_id_a")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    invoiceIdB: uuid("invoice_id_b")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("dismissed_duplicate_pairs_user_pair_idx").on(
      table.userId,
      table.invoiceIdA,
      table.invoiceIdB,
    ),
    index("dismissed_duplicate_pairs_user_idx").on(table.userId),
    check(
      "dismissed_duplicate_pairs_ordered",
      sql`${table.invoiceIdA} < ${table.invoiceIdB}`,
    ),
  ],
);
