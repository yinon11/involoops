import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { invoices } from "./invoices";

export const auditLog = pgTable("audit_log", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, {
    onDelete: "set null",
  }),
  action: varchar({ length: 50 }).notNull(),
  details: jsonb(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, {
    fields: [auditLog.userId],
    references: [users.id],
  }),
  invoice: one(invoices, {
    fields: [auditLog.invoiceId],
    references: [invoices.id],
  }),
}));
