import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { vendors } from "./vendors";

export const extractionRules = pgTable("extraction_rules", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id").references(() => vendors.id, {
    onDelete: "set null",
  }),
  priority: integer().default(0),
  name: varchar({ length: 255 }),
  rules: jsonb().notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const extractionRulesRelations = relations(
  extractionRules,
  ({ one }) => ({
    user: one(users, {
      fields: [extractionRules.userId],
      references: [users.id],
    }),
    vendor: one(vendors, {
      fields: [extractionRules.vendorId],
      references: [vendors.id],
    }),
  })
);
