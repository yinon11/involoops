// NOTE: this table holds presentation only. Issuer identity — legal name,
// address, tax ID — lives on business_entities (for drafts) and in the
// signed canonical JSON (for issued invoices); it was never sourced from
// here. The business_name / business_address / business_tax_id columns
// that used to shadow it were dropped in 0039. See
// src/lib/documents/issuer-identity.ts and src/lib/templates/business-config.ts.

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { TEMPLATE_DESIGN_IDS } from "@/types/template";

// Re-exported for backwards compatibility with existing imports;
// new code should import TEMPLATE_DESIGN_IDS / TemplateDesignId from
// `@/types/template` directly. The canonical list lives there so the
// renderers, PDF pipeline and DB schema can't drift.
export const templateDesignEnum = TEMPLATE_DESIGN_IDS;

export const invoiceTemplates = pgTable("invoice_templates", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar({ length: 255 }).notNull().default("Default"),
  designId: text("design_id", { enum: templateDesignEnum })
    .notNull()
    .default("classic"),
  accentColor: varchar("accent_color", { length: 7 }).default("#6366f1"),
  logoUrl: varchar("logo_url", { length: 1024 }),
  businessPhone: varchar("business_phone", { length: 50 }),
  businessEmail: varchar("business_email", { length: 255 }),
  businessWebsite: varchar("business_website", { length: 512 }),
  showVatBreakdown: boolean("show_vat_breakdown").default(true),
  // Bank-transfer details. Printed only on the payment-request family
  // (TAX_INVOICE / PROFORMA) — see src/lib/documents/bank-details.ts.
  showBankDetails: boolean("show_bank_details").default(false),
  bankAccountHolder: varchar("bank_account_holder", { length: 255 }),
  bankName: varchar("bank_name", { length: 120 }),
  bankBranch: varchar("bank_branch", { length: 60 }),
  bankAccountNumber: varchar("bank_account_number", { length: 60 }),
  bankIban: varchar("bank_iban", { length: 60 }),
  bankSwift: varchar("bank_swift", { length: 20 }),
  bankTransferNote: text("bank_transfer_note"),
  defaultCurrency: varchar("default_currency", { length: 3 }).default("ILS"),
  defaultLanguage: varchar("default_language", { length: 5 }).default("he"),
  isDefault: boolean("is_default").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const invoiceTemplatesRelations = relations(
  invoiceTemplates,
  ({ one }) => ({
    user: one(users, {
      fields: [invoiceTemplates.userId],
      references: [users.id],
    }),
  })
);
