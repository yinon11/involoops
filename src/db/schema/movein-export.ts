import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  date,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { businessEntities } from "./business-entities";

export const moveinExportSettings = pgTable(
  "movein_export_settings",
  {
    id: uuid().primaryKey().defaultRandom(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" })
      .unique(),
    exportEmail: varchar("export_email", { length: 255 }),
    method: text("method").notNull().default("detailed"),
    generalCash: varchar("general_cash", { length: 20 }).notNull().default("0"),
    creditCardCash: varchar("credit_card_cash", { length: 20 })
      .notNull()
      .default("0"),
    cash: varchar("cash", { length: 20 }).notNull().default("0"),
    checkCash: varchar("check_cash", { length: 20 }).notNull().default("0"),
    transferUsd: varchar("transfer_usd", { length: 20 }).notNull().default("0"),
    transferEur: varchar("transfer_eur", { length: 20 }).notNull().default("0"),
    transferGbp: varchar("transfer_gbp", { length: 20 }).notNull().default("0"),
    transferJpy: varchar("transfer_jpy", { length: 20 }).notNull().default("0"),
    paypal: varchar("paypal", { length: 20 }).notNull().default("0"),
    bit: varchar("bit", { length: 20 }).notNull().default("0"),
    pepper: varchar("pepper", { length: 20 }).notNull().default("0"),
    credit: varchar("credit", { length: 20 }).notNull().default("0"),
    purchase: varchar("purchase", { length: 20 }).notNull().default("0"),
    inputVat: varchar("input_vat", { length: 20 }).notNull().default("0"),
    withholdingTax: varchar("withholding_tax", { length: 20 })
      .notNull()
      .default("0"),
    outputVat: varchar("output_vat", { length: 20 }).notNull().default("0"),
    income: varchar("income", { length: 20 }).notNull().default("0"),
    exemptIncome: varchar("exempt_income", { length: 20 }).notNull().default("0"),
    cashCustomer: varchar("cash_customer", { length: 20 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const moveinExports = pgTable(
  "movein_exports",
  {
    id: uuid().primaryKey().defaultRandom(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull().unique(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["DONE", "FAILED"] })
      .notNull()
      .default("DONE"),
    movementCount: integer("movement_count"),
    invoiceCount: integer("invoice_count"),
    s3KeyZip: text("s3_key_zip"),
    validationErrors: jsonb("validation_errors"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("movein_exports_entity_created_at_idx").on(
      table.businessEntityId,
      table.createdAt,
    ),
  ],
);

export const moveinExportSettingsRelations = relations(
  moveinExportSettings,
  ({ one }) => ({
    businessEntity: one(businessEntities, {
      fields: [moveinExportSettings.businessEntityId],
      references: [businessEntities.id],
    }),
  }),
);

export const moveinExportsRelations = relations(moveinExports, ({ one }) => ({
  businessEntity: one(businessEntities, {
    fields: [moveinExports.businessEntityId],
    references: [businessEntities.id],
  }),
  requestedBy: one(users, {
    fields: [moveinExports.requestedByUserId],
    references: [users.id],
  }),
}));
