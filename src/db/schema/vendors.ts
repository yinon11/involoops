import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { invoices } from "./invoices";

export const vendors = pgTable(
  "vendors",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar({ length: 255 }).notNull(),
    aliases: text().array(),
    defaultCategory: varchar("default_category", { length: 100 }),
    isIncomeSource: boolean("is_income_source").default(false),
    autoApprove: boolean("auto_approve").default(false),
    websiteUrl: varchar("website_url", { length: 1024 }),
    websiteUrl2: varchar("website_url_2", { length: 1024 }),
    trackingExcluded: boolean("tracking_excluded").default(false),
    /** Hashavshevet customer card ("מספר לקוח בהנה״ח חיצונית"). */
    externalAccountNumber: varchar("external_account_number", { length: 20 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [uniqueIndex("vendors_user_id_name_idx").on(table.userId, table.name)]
);

export const vendorsRelations = relations(vendors, ({ one, many }) => ({
  user: one(users, {
    fields: [vendors.userId],
    references: [users.id],
  }),
  invoices: many(invoices),
}));
