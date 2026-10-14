import type { outboundInvoices } from "@/db/schema";
import type { OutboundLineItem } from "@/db/schema/outbound-invoices";

type Row = typeof outboundInvoices.$inferSelect;

interface ListRow {
  id: string;
  invoiceNumber: string | null;
  formattedNumber: string | null;
  documentType: Row["documentType"];
  taxYear: number;
  sequenceNumber: number | null;
  invoiceDate: string;
  dueDate: string | null;
  total: string;
  currency: string | null;
  status: Row["status"];
  shaamStatus: Row["shaamStatus"];
  allocationNumber: string | null;
  pdfKind: Row["pdfKind"];
  queuedDeliveryRecipient: string | null;
  customerName: string | null;
  createdAt: Date | null;
}

/**
 * Stable, human-readable handle for drafts that haven't been allocated a
 * fiscal number yet. Exposed as `draft_reference` on API responses so
 * consumers always have *something* to display.
 */
function buildDraftReference(id: string): string {
  return `DRAFT-${id.slice(0, 8)}`;
}

/** Compact list-view row. Mirrors `listOutboundInvoicesOp`'s SELECT. */
export function serializeOutboundInvoiceListRow(r: ListRow) {
  return {
    object: "outbound_invoice" as const,
    id: r.id,
    /**
     * `null` while the document is in `draft` status; populated atomically
     * by `issueOutboundInvoiceOp` together with `sequence_number`. Use
     * `draft_reference` for a UI-friendly placeholder.
     */
    formatted_number: r.formattedNumber,
    /** Stable handle for drafts; `null` once a fiscal number is allocated. */
    draft_reference: r.formattedNumber == null ? buildDraftReference(r.id) : null,
    document_type: r.documentType,
    tax_year: r.taxYear,
    sequence_number: r.sequenceNumber,
    invoice_date: r.invoiceDate,
    due_date: r.dueDate,
    total: r.total,
    currency: r.currency,
    status: r.status,
    shaam_status: r.shaamStatus,
    allocation_number: r.allocationNumber,
    pdf_url_kind: r.pdfKind,
    pdf_includes_allocation_number:
      r.pdfKind === "final" && r.allocationNumber != null,
    queued_for_delivery: r.queuedDeliveryRecipient != null,
    customer_name: r.customerName,
    created_at: r.createdAt?.toISOString() ?? null,
  };
}

/** Full detail. Always includes the items array and computed totals. */
export function serializeOutboundInvoice(row: Row) {
  return {
    object: "outbound_invoice" as const,
    id: row.id,
    /**
     * `null` while the document is in `draft` status. Allocation moves to
     * `issueOutboundInvoiceOp` so abandoned drafts don't punch holes in
     * the issued sequence (ITA Hora'ot Niho'ul Pinkasei Cheshbonot).
     */
    formatted_number: row.formattedNumber,
    /** Stable handle for drafts; `null` once a fiscal number is allocated. */
    draft_reference: row.formattedNumber == null ? buildDraftReference(row.id) : null,
    document_type: row.documentType,
    tax_year: row.taxYear,
    sequence_number: row.sequenceNumber,
    template_id: row.templateId,
    customer_id: row.customerId,
    invoice_date: row.invoiceDate,
    printed_date: row.printedDate,
    due_date: row.dueDate,
    items: (row.items ?? []) as OutboundLineItem[],
    payments: row.payments ?? [],
    subtotal: row.subtotal,
    vat_rate: row.vatRate,
    vat_amount: row.vatAmount,
    total: row.total,
    currency: row.currency,
    language: row.language,
    notes: row.notes,
    status: row.status,
    pdf_url: row.pdfUrl,
    /**
     * `interim` means the stored PDF was rendered before SHAAM produced
     * an allocation number — only possible for above-threshold docs
     * still in PENDING / OUTAGE_ISSUED. `final` means the customer-facing
     * PDF is the authoritative version (allocation present, or none
     * required).
     */
    pdf_url_kind: row.pdfKind,
    /** Convenience derivation. `false` whenever `pdf_url_kind === "interim"`. */
    pdf_includes_allocation_number:
      row.pdfKind === "final" && row.allocationNumber != null,
    shaam_status: row.shaamStatus,
    allocation_number: row.allocationNumber,
    sandbox: row.sandboxDocument,
    // Diagnostic fields for SHAAM submissions: callers polling a
    // `PENDING` invoice need a way to tell *why* it's pending (no
    // active authorization, network outage, ITA validation error, …)
    // without having to open the web UI. These mirror the columns the
    // retry cron / `submitDocumentToShaam` already populate.
    shaam_submitted_at: row.shaamSubmittedAt?.toISOString() ?? null,
    shaam_response_at: row.shaamResponseAt?.toISOString() ?? null,
    shaam_retry_count: row.shaamRetryCount ?? 0,
    shaam_last_error_code: row.shaamLastErrorCode,
    shaam_last_error_message: row.shaamLastErrorMessage,
    /**
     * Spec 08+ — the seller chose "queue and auto-send when SHAAM clears".
     * The SHAAM retry cron picks the queue up the moment it flips to
     * APPROVED and fires the email. `queued_delivery_recipient` exposes
     * the captured recipient for symmetry with the API.
     */
    queued_for_delivery: row.queuedDeliveryRecipient != null,
    queued_delivery_recipient: row.queuedDeliveryRecipient,
    queued_delivery_subject: row.queuedDeliverySubject,
    queued_delivery_queued_at:
      row.queuedDeliveryQueuedAt?.toISOString() ?? null,
    references_document_id: row.referencesDocumentId,
    net_of_credits_amount: row.netOfCreditsAmount,
    version: row.version,
    created_at: row.createdAt?.toISOString() ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
  };
}
