import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  date,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { vendors } from "./vendors";
import { outboundInvoices } from "./outbound-invoices";

export const invoiceTypeEnum = ["expense", "income"] as const;
export const invoiceStatusEnum = [
  "processing",
  "pending",
  "approved",
  "rejected",
] as const;
export const extractionMethodEnum = ["text", "vision", "manual"] as const;

export const invoices = pgTable(
  "invoices",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id").references(() => vendors.id, {
      onDelete: "set null",
    }),
    /** Extracted supplier name when no vendor was matched; user must link or create a vendor. */
    suggestedVendorName: varchar("suggested_vendor_name", { length: 512 }),
    type: text({ enum: invoiceTypeEnum }).default("expense"),
    status: text({ enum: invoiceStatusEnum }).default("processing"),
    invoiceNumber: varchar("invoice_number", { length: 255 }),
    invoiceDate: date("invoice_date"),
    amount: numeric({ precision: 12, scale: 2 }).notNull(),
    currency: varchar({ length: 3 }).default("ILS"),
    vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }),
    amountWithoutVat: numeric("amount_without_vat", { precision: 12, scale: 2 }),
    description: text(),
    fileUrl: varchar("file_url", { length: 1024 }),
    fileName: varchar("file_name", { length: 255 }),
    fileHash: varchar("file_hash", { length: 64 }),
    /** PDF page count, populated by the extraction pipeline. Used by the
     * pending-queue "Split into separate invoices" button to decide whether
     * the invoice can potentially contain multiple receipts. NULL = unknown
     * (legacy rows uploaded before this column existed). */
    pageCount: integer("page_count"),
    extractedText: text("extracted_text"),
    extractionMethod: text("extraction_method", {
      enum: extractionMethodEnum,
    }),
    extractionConfidence: numeric("extraction_confidence", {
      precision: 3,
      scale: 2,
    }),
    rejectionReason: text("rejection_reason"),
    /** YYYY-MM when the file was first uploaded (not invoice document date). */
    addedMonth: varchar("added_month", { length: 7 }),
    /** Set when the user marks the invoice as sent to their accountant. */
    sentToAccountantAt: timestamp("sent_to_accountant_at"),
    /**
     * What fraction of the VAT on this invoice is deductible as input VAT.
     * 100 = full credit (default). Partial-credit categories (e.g. private
     * vehicle fuel = 66) must be set manually — auto-detection is deferred
     * until the full category list is confirmed.
     */
    vatCreditPercent: integer("vat_credit_percent").default(100),
    /** LLM token tracking */
    llmInputTokens: integer("llm_input_tokens").default(0),
    llmOutputTokens: integer("llm_output_tokens").default(0),
    llmCostUsd: numeric("llm_cost_usd", { precision: 10, scale: 6 }).default("0"),
    /**
     * Free-text label classifying what was purchased — populated by the
     * extraction LLM (e.g. "computer", "vehicle", "office furniture").
     * NULL when classification was unclear or extraction failed.
     */
    expenseCategory: text("expense_category"),
    /**
     * True when AI or user flags this row as a capital expenditure
     * (depreciable over multiple years). Drives the "add to depreciation
     * schedule" prompt and the import picker on /outbound/tax-estimates.
     */
    isFixedAsset: boolean("is_fixed_asset").notNull().default(false),
    /**
     * True once this invoice has been appended to
     * tax_estimate_inputs.fixed_assets so the prompts/import picker can
     * hide already-handled rows.
     */
    fixedAssetSynced: boolean("fixed_asset_synced").notNull().default(false),
    /**
     * Payment splits carried over by the one-off historical import, used by the
     * MOVEIN export: (amount, paymentType, date). `paymentType` is the numeric
     * code from the system the rows came from; nothing writes this any more.
     */
    importPayments: jsonb("import_payments").$type<
      Array<{ amount: number; paymentType: number; date: string }>
    >(),
    /** Hashavshevet customer GL card — per invoice (not per vendor). */
    customerAccountNumber: varchar("customer_account_number", { length: 20 }),
    /**
     * Set when this income row was created from a document this business
     * issued. The issued document stays the source of truth; this row is
     * the copy that shows up in the invoices list as approved income.
     * Null for uploaded documents.
     */
    outboundInvoiceId: uuid("outbound_invoice_id").references(
      () => outboundInvoices.id,
      { onDelete: "cascade" },
    ),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("invoices_user_id_file_hash_idx").on(
      table.userId,
      table.fileHash
    ),
    index("invoices_user_id_invoice_date_idx").on(
      table.userId,
      table.invoiceDate
    ),
    uniqueIndex("invoices_outbound_invoice_id_unique").on(
      table.outboundInvoiceId
    ),
  ]
);

export const invoicesRelations = relations(invoices, ({ one }) => ({
  user: one(users, {
    fields: [invoices.userId],
    references: [users.id],
  }),
  vendor: one(vendors, {
    fields: [invoices.vendorId],
    references: [vendors.id],
  }),
}));
