import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  date,
  integer,
  bigint,
  jsonb,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users } from "./users";
import { customers } from "./customers";
import { invoiceTemplates } from "./invoice-templates";
import { businessEntities } from "./business-entities";
import { documentTypeEnum } from "./document-number-sequences";

/**
 * Outbound invoice lifecycle states.
 *
 * Spec 04 adds `issued` (signed, immutable, ready for delivery) between
 * `draft` and `sent`, and renames the terminal `cancelled` → `voided`
 * to align with ITA terminology for חשבונית זיכוי (credit notes).
 * Allowed transitions (enforced in the server actions):
 *
 *   draft  → issued      via `issueOutboundInvoice` (also signs the doc)
 *   draft  → voided      via `deleteOutboundInvoice` (soft-delete of drafts)
 *   issued → sent | paid | voided
 *
 * Direct `draft → sent` / `draft → paid` transitions are rejected —
 * documents must be signed first. `voided` from an issued document
 * requires the credit-note flow (spec 06); for now the server action
 * accepts it with a reason.
 */
export const outboundInvoiceStatusEnum = [
  "draft",
  "issued",
  "sent",
  "paid",
  "voided",
] as const;

export type OutboundInvoiceStatus =
  (typeof outboundInvoiceStatusEnum)[number];

export interface OutboundLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

/**
 * Payment entries for TAX_INVOICE_RECEIPT and RECEIPT documents.
 * Shape + validation lives in `src/lib/documents/payments.ts`.
 */
export interface OutboundPaymentEntry {
  method: "cash" | "check" | "card" | "bank_transfer" | "withholding_tax" | "other";
  amount: number;
  currency: string;
  date: string;
  reference?: string;
}

export const outboundInvoices = pgTable(
  "outbound_invoices",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Business entity (עוסק) the document belongs to. Currently 1:1 with
     * `userId` but the authoritative scope for sequence numbering, RBAC
     * checks, and the audit-log hash chain.
     */
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "restrict" }),
    templateId: uuid("template_id").references(() => invoiceTemplates.id, {
      onDelete: "set null",
    }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    /**
     * Email printed in the customer block of this document.
     * NULL means the document predates the field and the customer
     * record's email is used. An empty string means the seller cleared
     * it and nothing is printed. Any other value is printed as written,
     * even when it differs from the customer record.
     */
    customerEmail: varchar("customer_email", { length: 255 }),
    /**
     * @deprecated Use `formattedNumber`. Retained for backward compatibility
     * with legacy readers. The issue flow mirrors `formattedNumber` into it
     * automatically; null while the row is in `draft` status.
     */
    invoiceNumber: varchar("invoice_number", { length: 100 }),
    /** ITA-compliant document type; drives sequence and formatted-number prefix. */
    documentType: documentTypeEnum("document_type")
      .notNull()
      .default("TAX_INVOICE"),
    /** Tax year the document is attributed to; derived from `invoiceDate` on insert. */
    taxYear: integer("tax_year").notNull(),
    /**
     * Gapless counter from `document_number_sequences`; ordering key for this
     * year/type. NULL while the row is in `draft` status — the fiscal number
     * is allocated at issue time so abandoned drafts don't punch holes in
     * the issued sequence (ITA Pinkasei Hashbonot, sec. 23-A). The DB
     * constraint `outbound_invoices_issued_has_number` enforces non-null
     * for any non-draft status.
     */
    sequenceNumber: bigint("sequence_number", { mode: "number" }),
    /**
     * Human-readable number, e.g. `2026-TI-000001`. NULL for drafts; populated
     * by `issueOutboundInvoiceOp` together with `sequenceNumber`. See
     * `lib/documents/format-number.ts`.
     */
    formattedNumber: text("formatted_number"),
    /**
     * Value date, or the payment date the user entered on the draft.
     * This is not the date printed as the issue date. On issue,
     * `printedDate` is set to the Israel civil day and this column is
     * left as the user entered it.
     */
    invoiceDate: date("invoice_date").notNull(),
    /**
     * Date printed on the document and used for the numbering series.
     * Null on drafts. Set to the Israel civil day at issue. Older issued
     * rows leave this null; their printed date is `invoiceDate`.
     */
    printedDate: date("printed_date"),
    dueDate: date("due_date"),
    items: jsonb().$type<OutboundLineItem[]>().notNull().default([]),
    /**
     * Payment entries for TAX_INVOICE_RECEIPT / RECEIPT documents.
     * Empty array for plain tax invoices. See migration 0032.
     */
    payments: jsonb().$type<OutboundPaymentEntry[]>().notNull().default([]),
    subtotal: numeric({ precision: 12, scale: 2 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).default("18"),
    vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }),
    total: numeric({ precision: 12, scale: 2 }).notNull(),
    currency: varchar({ length: 3 }).default("ILS"),
    language: varchar({ length: 5 }).default("he"),
    notes: text(),
    /**
     * Credit notes set this to the original invoice they reverse.
     * Denormalised copy of the canonical `document_links` row for
     * fast display lookups. Self-referential FK is `RESTRICT` because
     * a referenced original can never be physically deleted.
     */
    referencesDocumentId: uuid("references_document_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => outboundInvoices.id,
      { onDelete: "restrict" },
    ),
    /**
     * Running "what's left to credit" balance for tax invoices. Populated
     * with `total` at insert time and decremented atomically (row lock +
     * string-cents math) by `issueCreditNote`. Null for non-tax documents.
     */
    netOfCreditsAmount: numeric("net_of_credits_amount", {
      precision: 14,
      scale: 2,
    }),
    status: text({ enum: outboundInvoiceStatusEnum }).default("draft"),
    pdfUrl: varchar("pdf_url", { length: 1024 }),
    /**
     * When the מקור PDF was first handed out, by download or by email.
     * Null means the next handout is still the original. Set back to
     * null when a new original is published (an allocation number was
     * stamped onto the file).
     */
    originalReleasedAt: timestamp("original_released_at", {
      withTimezone: true,
    }),
    /**
     * Last time the PDF was emailed to the customer. Denormalised from
     * the audit log (STATUS_CHANGED w/ payload.method = "email") so
     * list views can show "last sent" without a join. Null until the
     * first successful send; updated on every resend.
     */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /**
     * Spec 08 — SHAAM clearance status. `NOT_APPLICABLE` is the
     * resting state until we call `requiresAllocation`; afterwards it
     * flips to `NOT_REQUIRED` (below threshold) or one of the
     * post-submission states.
     */
    shaamStatus: text("shaam_status", {
      enum: [
        "NOT_APPLICABLE",
        "NOT_REQUIRED",
        "PENDING",
        "APPROVED",
        "REJECTED",
        "HELD",
        "OUTAGE_ISSUED",
        // Spec 08+ rejection resolution. The ITA refused the allocation
        // and the seller picked one of the statutory options
        // (`docs/ita-compliance/shaam-rejection-plan.md`). Both are
        // terminal *by the seller's choice*, not by the ITA's — the
        // original refusal stays readable in `shaamLastError*`.
        "ISSUED_WITHOUT_ALLOCATION",
        "CANCELLED_AFTER_REJECTION",
        // Our retry ladder ran out. Nobody at the ITA refused anything —
        // this used to be written as REJECTED, which rendered to the
        // seller as "נדחה על ידי רשות המסים" and is simply untrue.
        "UNRESOLVED",
      ],
    })
      .notNull()
      .default("NOT_APPLICABLE"),
    allocationNumber: text("allocation_number"),
    /**
     * Copied from `business_entities.shaam_sandbox` at issue time so
     * the issued document stays marked even if the entity flag changes.
     */
    sandboxDocument: boolean("sandbox_document").notNull().default(false),
    shaamSubmittedAt: timestamp("shaam_submitted_at", { withTimezone: true }),
    shaamResponseAt: timestamp("shaam_response_at", { withTimezone: true }),
    /** 1 = new invoice, 2 = cancel, 3 = reverse charge, 4 = proforma link. */
    shaamActionCode: integer("shaam_action_code"),
    shaamIdempotencyKey: text("shaam_idempotency_key"),
    shaamRequestId: text("shaam_request_id"),
    shaamLastErrorCode: text("shaam_last_error_code"),
    shaamLastErrorMessage: text("shaam_last_error_message"),
    shaamRetryCount: integer("shaam_retry_count").notNull().default(0),
    /**
     * How many times we have asked the ITA to reconsider a hold.
     *
     * Separate from `shaamRetryCount` on purpose. That one counts failed
     * delivery attempts and, at `MAX_RETRIES`, retires the document as
     * unclearable — which is the wrong verdict for a hold, where nothing
     * failed and the ITA is simply still deciding. Sharing one counter
     * would let a patiently-polled hold be mistaken for a broken document.
     * This one only paces the slow ladder in
     * `/api/cron/shaam-retry-pending`.
     */
    shaamHoldPollCount: integer("shaam_hold_poll_count").notNull().default(0),
    /**
     * מועד השימוע — the deadline the ITA returns with a hold, parsed by
     * `extractHearingDeadline` in `lib/shaam/client.ts`.
     *
     * This is the seller's clock, not ours. The hearing window is short,
     * and a hold the ITA does not decide inside it can end with the
     * allocation granted by default — so whether the window is still open
     * changes what the seller should do. Cleared when the hold resolves
     * into an allocation, because a stale date reads as a live deadline.
     */
    shaamHearingDeadline: timestamp("shaam_hearing_deadline", {
      withTimezone: true,
    }),
    /**
     * Which statutory option the seller picked after the ITA refused an
     * allocation number, and who picked it. NULL until a refusal is
     * actually resolved — a document that never got rejected, or one
     * still sitting on an unresolved rejection, leaves all three NULL.
     *
     * `issue_without_allocation` is the one that produces a delivered
     * document: it is issued, signed and archived exactly like any other
     * invoice, but carries no allocation number, so the buyer cannot
     * deduct input VAT. `cancel` voids the document and leaves the burnt
     * fiscal number in the series as an explained gap.
     */
    shaamRejectionChoice: text("shaam_rejection_choice", {
      // `reverse_charge` — route B (spec §2.2.2): resolved by an action-3
      // request; set when the ITA returns the special allocation number.
      enum: ["issue_without_allocation", "cancel", "reverse_charge"],
    }),
    shaamRejectionChoiceAt: timestamp("shaam_rejection_choice_at", {
      withTimezone: true,
    }),
    shaamRejectionChoiceBy: uuid("shaam_rejection_choice_by").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    /**
     * `interim` means the stored `pdfUrl` was rendered without a SHAAM
     * allocation number — typically an outage-issued doc still chasing
     * its allocation via the retry cron. `final` means the customer-facing
     * PDF is the version SHAAM ultimately stamped (or one for which no
     * allocation is required). Flipped to `final` by the
     * `regenerateAndArchiveFinalPdf` helper after the cron clears.
     * `pdf_includes_allocation_number` in the API serializer is derived
     * from this column + `allocationNumber`.
     */
    /**
     * Reverse charge (היפוך חיוב), route A: issued at zero VAT because the
     * buyer agreed to report and pay the VAT themselves. Prints the caption
     * the ITA spec requires, and issuing insists on a signed consent that
     * still covers the document (`currentValidConsent`).
     */
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    /** The consent this document was issued on. No FK — see migration 0046. */
    reverseChargeConsentId: uuid("reverse_charge_consent_id"),
    /**
     * Route B: this zero-VAT invoice replaces the refused original named
     * here (migration 0049). It has its own fiscal number; its allocation
     * request (action 3) carries the original's Invoice_Id, and the
     * original is storno'd when the special number arrives.
     */
    reverseChargeReplacesId: uuid("reverse_charge_replaces_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => outboundInvoices.id,
      { onDelete: "restrict" },
    ),
    /**
     * ILS per 1 unit of `currency`, frozen when the fiscal number is
     * allocated (migration 0047). Every ILS figure of an issued
     * foreign-currency document — printed, exported, sent to the ITA —
     * uses this, never the rate of the day it happens to be rendered.
     */
    fxRateToIls: numeric("fx_rate_to_ils", { precision: 18, scale: 6 }),
    fxRateSource: varchar("fx_rate_source", { length: 16 }),
    fxRateFetchedAt: timestamp("fx_rate_fetched_at", { withTimezone: true }),
    /** When BOI published that rate — which day's rate the document used. */
    fxRatePublishedAt: timestamp("fx_rate_published_at", { withTimezone: true }),
    pdfKind: text("pdf_kind", { enum: ["interim", "final"] })
      .notNull()
      .default("interim"),
    /**
     * Spec 08+ — "queue and auto-send when SHAAM clears". When the seller
     * tries to send an invoice whose SHAAM is PENDING/OUTAGE_ISSUED, the
     * UI offers to queue the email for delivery as soon as the retry
     * cron flips the status to APPROVED. These columns capture the
     * delivery params; the cron clears them atomically with the auto-send.
     * All NULL = no queued send.
     */
    queuedDeliveryRecipient: text("queued_delivery_recipient"),
    queuedDeliverySubject: text("queued_delivery_subject"),
    queuedDeliveryBodyText: text("queued_delivery_body_text"),
    queuedDeliveryQueuedAt: timestamp("queued_delivery_queued_at", {
      withTimezone: true,
    }),
    queuedDeliveryAttachCertificate: boolean(
      "queued_delivery_attach_certificate",
    )
      .notNull()
      .default(false),
    queuedDeliveryQueuedBy: uuid("queued_delivery_queued_by").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    /**
     * Monotonic row version bumped inside the same transaction as any
     * mutation. Feeds UPDATED audit payloads so spec 02's `changedFields`
     * is anchored to a specific pre-image.
     */
    version: integer("version").notNull().default(1),
    /**
     * Soft-delete tombstone. NULL for active rows. Populated only by the
     * draft-delete path; mutations of non-draft documents are rejected
     * outright. Physical deletes are not performed by application code.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** User who performed the soft-delete. NULL while `deletedAt` is NULL. */
    deletedBy: uuid("deleted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * When the document was committed to issuance — stamped in the same
     * transaction that allocates the fiscal number, so it moves in lockstep
     * with `sequenceNumber` / `formattedNumber`.
     *
     * NOT the same as `documentSignatures.signedAt`: a SHAAM rejection after
     * allocation leaves a burnt number and an `issuedAt` on a row that is
     * still `draft` and has no signature. That is deliberate — the number is
     * spent either way, and the outbound daily cap counts spent numbers.
     *
     * Backfilled from `document_signatures.signed_at` for rows issued before
     * this column existed.
     */
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("outbound_invoices_user_id_date_idx").on(
      table.userId,
      table.invoiceDate
    ),
    /**
     * Backs the per-customer daily issuance cap COUNT. Partial — only
     * issued rows are ever counted, and drafts dominate the table.
     */
    index("outbound_invoices_customer_issued_at_idx")
      .on(table.customerId, table.issuedAt)
      .where(sql`${table.issuedAt} is not null`),
    index("outbound_invoices_business_entity_id_idx").on(
      table.businessEntityId
    ),
    index("outbound_invoices_user_type_year_idx").on(
      table.userId,
      table.documentType,
      table.taxYear
    ),
    unique("outbound_invoices_user_type_year_seq_unique").on(
      table.userId,
      table.documentType,
      table.taxYear,
      table.sequenceNumber
    ),
  ]
);

export const outboundInvoicesRelations = relations(
  outboundInvoices,
  ({ one }) => ({
    user: one(users, {
      fields: [outboundInvoices.userId],
      references: [users.id],
    }),
    template: one(invoiceTemplates, {
      fields: [outboundInvoices.templateId],
      references: [invoiceTemplates.id],
    }),
    customer: one(customers, {
      fields: [outboundInvoices.customerId],
      references: [customers.id],
    }),
  })
);
