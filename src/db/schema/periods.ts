import {
  pgTable,
  uuid,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

export const periods = pgTable(
  "periods",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    year: integer().notNull(),
    month: integer().notNull(),
    isLocked: boolean("is_locked").default(false),
    lockedAt: timestamp("locked_at"),
  },
  (table) => [
    uniqueIndex("periods_user_id_year_month_idx").on(
      table.userId,
      table.year,
      table.month
    ),
  ]
);

export const periodsRelations = relations(periods, ({ one }) => ({
  user: one(users, {
    fields: [periods.userId],
    references: [users.id],
  }),
}));
