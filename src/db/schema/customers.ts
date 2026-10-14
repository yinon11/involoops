import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

export const customers = pgTable(
  "customers",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }),
    phone: varchar({ length: 50 }),
    address: text(),
    taxId: varchar("tax_id", { length: 100 }),
    /** Hashavshevet / external GL customer card ("מספר לקוח בהנה״ח חיצונית"). */
    externalAccountNumber: varchar("external_account_number", { length: 20 }),
    notes: text(),
    /**
     * Delivery preference for outbound invoices. `null` means the
     * issuer is prompted after each issuance (default); `true` skips
     * the prompt and auto-emails the PDF; `false` skips the prompt
     * and leaves the invoice unsent.
     */
    autoSendInvoices: boolean("auto_send_invoices"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("customers_user_id_name_idx").on(table.userId, table.name),
  ]
);

export const customersRelations = relations(customers, ({ one }) => ({
  user: one(users, {
    fields: [customers.userId],
    references: [users.id],
  }),
}));
