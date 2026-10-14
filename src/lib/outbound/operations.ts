/**
 * Caller-parameterized outbound-invoice operations.
 *
 * Same logic the server actions have always run — extracted here so both
 * the existing UI actions (`src/actions/outbound-invoice-actions.ts`) and
 * the public REST API (`src/app/api/v1/outbound-invoices/...`) can call
 * a single implementation. Each function takes `caller: CallerContext`
 * explicitly; the action wrappers resolve it from the session, the API
 * routes resolve it from the API key.
 *
 * Compliance invariants are preserved:
 *   - Spec 04 immutability: drafts only for create/update/delete;
 *     post-issue mutations limited to status + pdfUrl.
 *   - Spec 02 audit log: every mutation calls `appendAuditEntry`.
 *   - Spec 03 RBAC: every operation calls `requirePermission`.
 *   - Spec 01 sequencing: gapless allocator stays the only writer.
 *
 * No `revalidatePath` here — that belongs to the action wrapper, not the
 * core operation. The API does not need it.
 */

import { db } from "@/db";
import {
  outboundInvoices,
  customers,
  invoiceTemplates,
  users,
  shaamSubmissions,
  businessEntities,
} from "@/db/schema";
import { compareMoney } from "@/lib/money";
import { documentTotalMustBePositiveMessage } from "@/lib/documents/positive-total";
import type {
  OutboundLineItem,
  OutboundInvoiceStatus,
} from "@/db/schema/outbound-invoices";
import { eq, and, desc, inArray, isNull, sql } from "drizzle-orm";
import {
  assertPrintedDateFollowsSeries,
  printedDateForIssue,
  PrintedDateOrderError,
} from "@/lib/outbound/issue-dates";
import { allocateDocumentNumberTx } from "@/features/generator/actions/document-number-actions";
import { isDocumentType, type DocumentType } from "@/lib/documents/types";
import {
  InvoicePaymentValidationError,
  validatePayments,
  type PaymentEntry,
} from "@/lib/documents/payments";
import { readWithholdingCertificate } from "@/lib/documents/withholding-certificate";
import { assessCashCeiling } from "@/lib/documents/cash-ceiling";
import { invoiceContentLimitMessage } from "@/lib/documents/invoice-limits";
import { buildIssuerIdentityFromEntity } from "@/lib/documents/issuer-identity";
import { appendAuditEntry } from "@/lib/audit/append";
import { diffFields } from "@/lib/audit/helpers";
import { getBusinessEntityForUser } from "@/lib/rbac/current-business-entity";
import { requirePermission } from "@/lib/rbac/authorize";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  getMissingIssuerFields,
  IssuerNotReadyError,
} from "@/lib/business-entity/identity";
import {
  canIssueOutboundDocument,
  OUTBOUND_DOCUMENTS_LOCKED_MESSAGE,
} from "@/lib/outbound/ita-issuance-gate";
import {
  computeSignatureForDraft,
  persistSignatureTx,
} from "@/lib/signing/sign";
import { archiveDocument } from "@/lib/archive/store";
import { generateInvoicePdf } from "@/lib/pdf/generate-pdf";
import {
  claimOriginalRelease,
  handOutStoredInvoicePdf,
  storeIssuedCopyPdf,
} from "@/lib/outbound/invoice-pdf-copy";
import {
  buildPdfSignatureStamp,
  loadPdfSignatureStamp,
} from "@/lib/pdf/signature-stamp";
import { submitDocumentToShaam } from "@/lib/shaam/submit";
import { requiresAllocation } from "@/lib/shaam/thresholds";
import { customerTaxIdBlocksIssue } from "@/lib/shaam/customer-tax-id";
import {
  abandonRefusedReplacement,
  createReverseChargeReplacementOp,
  findActiveReplacement,
  reverseChargeIssueCheck,
} from "@/lib/outbound/reverse-charge";
import { archiveConsentEvidence } from "@/lib/outbound/reverse-charge-archive";
import { notifyShaamDecision } from "@/lib/shaam/notify-decision";
import {
  classifyShaamRejection,
  type ShaamRejectionKind,
  type ShaamRejectionOption,
} from "@/lib/shaam/rejection-options";
import { uploadFile } from "@/lib/storage";
import { notifyAdminOfShaamOutage } from "@/lib/email/shaam-outage-notify";
import type { TemplateConfig, InvoiceData } from "@/types/template";
import { withForeignExchangeDisplay } from "@/lib/outbound/foreign-exchange-display";
import {
  FxRateUnavailableError,
  ensureFreshRateToIls,
  resolveRateToIls,
  type ResolvedRate,
} from "@/lib/fx/usd-ils-rate";
import { allocationAmountsIls } from "@/lib/shaam/allocation-amounts";
import { printedCustomerEmail } from "@/lib/outbound/printed-customer-email";
import { buildTemplateConfig } from "@/lib/templates/business-config";
import { resolveTemplateLogo } from "@/lib/templates/logo";
import { emitEvent } from "@/lib/webhooks/emit";
import { resolveReplyToAddress } from "@/lib/email/address";
import { sendInvoiceEmail } from "@/lib/email/send-invoice-email";
import { documentSignatures } from "@/db/schema";
import {
  OutboundCustomerDailyLimitError,
  assertOutboundCustomerDailyLimitTx,
  resolveOutboundCustomerDailyLimit,
} from "@/lib/outbound/customer-daily-limit";
import { canCancelWithoutCreditNote } from "@/lib/documents/cancellation";
import { mirrorIssuedIncomeForUser } from "@/lib/outbound/income-mirror";
import { buildIssuerIdentityFromCanonical } from "@/lib/documents/issuer-identity";
import type { CanonicalDocument } from "@/lib/signing/canonical-document";

export interface CallerContext {
  userId: string;
  businessEntityId: string;
}

/** Resolve the caller's business entity from a userId. */
export async function callerFromUserId(userId: string): Promise<CallerContext> {
  const entity = await getBusinessEntityForUser(userId);
  return { userId, businessEntityId: entity.id };
}

/**
 * Tax documents. Once issued, one is cancelled only by a credit invoice
 * that reverses it — never by flipping its status — so the cancellation
 * is itself a numbered, reportable document. Receipts, proformas and
 * delivery notes carry no VAT and may still be voided.
 */
export {
  canCancelWithoutCreditNote,
  DOCUMENT_TYPES_REQUIRING_CREDIT_NOTE as CANCELLED_BY_CREDIT_NOTE_ONLY,
} from "@/lib/documents/cancellation";

/** Refusal to void a tax document; the API maps it to 422 `cannot_void_document_type`. */
export class CannotVoidDocumentTypeError extends Error {
  constructor(documentType: string) {
    super(
      `An issued ${documentType} cannot be voided: it is cancelled with a credit invoice that reverses it.`,
    );
    this.name = "CannotVoidDocumentTypeError";
  }
}

/** Status transitions allowed via `updateOutboundInvoiceStatusOp`. */
const ALLOWED_STATUS_TRANSITIONS: Record<
  OutboundInvoiceStatus,
  ReadonlySet<OutboundInvoiceStatus>
> = {
  // A draft is discarded (`deleteOutboundInvoiceOp`), or — when it already
  // holds a number from a refused issue — cancelled after the refusal.
  draft: new Set<OutboundInvoiceStatus>(),
  issued: new Set<OutboundInvoiceStatus>(["sent", "paid", "voided"]),
  sent: new Set<OutboundInvoiceStatus>(["paid", "voided"]),
  paid: new Set<OutboundInvoiceStatus>(["voided"]),
  voided: new Set<OutboundInvoiceStatus>(),
};

// ---------- Reads ----------

/**
 * Per-row payment state derived from `status` + linked-receipt sum.
 * Lets the list UI tag plain tax invoices that are partway settled
 * with a distinct chip ("Partial") and filter "Open for collection"
 * without re-deriving the math on the client.
 *
 *   - `paid`     — explicit `status === 'paid'` (or auto-flipped from
 *                  full receipt settlement)
 *   - `partial`  — `status` is issued/sent AND linked receipts cover
 *                  some but not all of the outstanding balance
 *   - `open`     — issued/sent with no linked receipts and balance > 0
 *   - `draft`    — draft row
 *   - `voided`   — explicit voided
 *   - `n_a`      — document type doesn't carry an outstanding balance
 *                  (RECEIPT, CREDIT_INVOICE, PROFORMA, DELIVERY_NOTE,
 *                  TAX_INVOICE_RECEIPT — paid by construction or not a
 *                  debt-bearing document)
 */
export type OutboundPaymentState =
  | "paid"
  | "partial"
  | "open"
  | "draft"
  | "voided"
  | "n_a";

/**
 * Document types that carry an outstanding balance a customer still owes.
 * Everything else (RECEIPT, CREDIT_INVOICE, PROFORMA, DELIVERY_NOTE and
 * TAX_INVOICE_RECEIPT — paid by construction) is never "open for
 * collection", so both the outbound list and the collections dashboard
 * filter on this set.
 */
export const SETTLEABLE_DOC_TYPES: ReadonlySet<DocumentType> = new Set([
  "TAX_INVOICE",
]);

export async function listOutboundInvoicesOp(caller: CallerContext) {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_VIEW,
    route: "listOutboundInvoicesOp",
  });
  const rows = await db
    .select({
      id: outboundInvoices.id,
      invoiceNumber: outboundInvoices.invoiceNumber,
      formattedNumber: outboundInvoices.formattedNumber,
      documentType: outboundInvoices.documentType,
      taxYear: outboundInvoices.taxYear,
      sequenceNumber: outboundInvoices.sequenceNumber,
      invoiceDate: outboundInvoices.invoiceDate,
      dueDate: outboundInvoices.dueDate,
      total: outboundInvoices.total,
      netOfCreditsAmount: outboundInvoices.netOfCreditsAmount,
      currency: outboundInvoices.currency,
      status: outboundInvoices.status,
      shaamStatus: outboundInvoices.shaamStatus,
      allocationNumber: outboundInvoices.allocationNumber,
      pdfKind: outboundInvoices.pdfKind,
      queuedDeliveryRecipient: outboundInvoices.queuedDeliveryRecipient,
      customerName: customers.name,
      notes: outboundInvoices.notes,
      createdAt: outboundInvoices.createdAt,
    })
    .from(outboundInvoices)
    .leftJoin(customers, eq(outboundInvoices.customerId, customers.id))
    .where(
      and(
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .orderBy(desc(outboundInvoices.createdAt));

  // Sum non-voided/non-draft RECEIPT totals grouped by parent invoice.
  // Joined client-side so we can attach `outstandingAmount` +
  // `paymentState` to every row in a single `listOutboundInvoicesOp`
  // call. Cheap — receipt counts per BE are bounded.
  const receiptSums = await db
    .select({
      parentId: outboundInvoices.referencesDocumentId,
      total: outboundInvoices.total,
      status: outboundInvoices.status,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        eq(outboundInvoices.documentType, "RECEIPT"),
        isNull(outboundInvoices.deletedAt),
      ),
    );
  const settledByParent = new Map<string, number>();
  for (const r of receiptSums) {
    if (!r.parentId) continue;
    if (r.status === "voided" || r.status === "draft") continue;
    settledByParent.set(
      r.parentId,
      (settledByParent.get(r.parentId) ?? 0) + Number(r.total),
    );
  }

  return rows.map((row) => {
    const isSettleable = SETTLEABLE_DOC_TYPES.has(row.documentType);
    const baseRemaining = Number(row.netOfCreditsAmount ?? row.total);
    const settled = settledByParent.get(row.id) ?? 0;
    const outstanding = isSettleable
      ? Math.max(0, baseRemaining - settled)
      : 0;

    let paymentState: OutboundPaymentState;
    if (!isSettleable) paymentState = "n_a";
    else if (row.status === "draft") paymentState = "draft";
    else if (row.status === "voided") paymentState = "voided";
    else if (row.status === "paid") paymentState = "paid";
    else if (settled > 0 && outstanding > 0) paymentState = "partial";
    else paymentState = "open";

    return {
      ...row,
      outstandingAmount: outstanding.toFixed(2),
      settledAmount: settled.toFixed(2),
      paymentState,
    };
  });
}

export async function getOutboundInvoiceByIdOp(
  caller: CallerContext,
  id: string,
) {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_VIEW,
    route: "getOutboundInvoiceByIdOp",
  });
  const [row] = await db
    .select()
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.id, id),
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const customer = row.customerId
    ? await db.query.customers.findFirst({
        where: eq(customers.id, row.customerId),
      })
    : null;
  const template = row.templateId
    ? await db.query.invoiceTemplates.findFirst({
        where: eq(invoiceTemplates.id, row.templateId),
      })
    : null;

  return { ...row, customer, template };
}

// ---------- Writes ----------

export interface CreateOutboundInput {
  templateId?: string | null;
  customerId?: string | null;
  documentType?: DocumentType;
  invoiceDate: string;
  dueDate?: string | null;
  items: OutboundLineItem[];
  subtotal: string;
  vatRate?: string;
  vatAmount?: string;
  total: string;
  currency?: string;
  language?: string;
  notes?: string | null;
  /**
   * Email printed on this document. Omit to keep the legacy behaviour
   * (the customer record's email). Pass "" to print nothing. Pass an
   * address to print that, without changing the customer record.
   */
  customerEmail?: string | null;
  payments?: PaymentEntry[];
  /**
   * Receipts can settle a previously-issued tax invoice; setting this
   * stores a reference to the parent so the issue flow can flip the
   * parent's status to `paid` once the receipt is signed and the
   * invoice's outstanding balance reaches zero. Only allowed when
   * `documentType === "RECEIPT"`. The parent must be a TAX_INVOICE in
   * status `issued` or `sent`, owned by the same business entity, and
   * carry an outstanding balance > 0.
   */
  referencesDocumentId?: string | null;
}

export async function createOutboundInvoiceOp(
  caller: CallerContext,
  data: CreateOutboundInput,
) {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_CREATE_DRAFT,
    route: "createOutboundInvoiceOp",
  });

  const entity = await getBusinessEntityForUser(caller.userId);
  const missing = getMissingIssuerFields({
    legalName: entity.legalName,
    osekMurshe: entity.osekMurshe,
    entityType: entity.entityType,
    address: entity.address,
  });
  if (missing.length > 0) {
    throw new IssuerNotReadyError(missing);
  }

  const documentType: DocumentType = isDocumentType(data.documentType)
    ? data.documentType
    : "TAX_INVOICE";

  const taxYear = Number(data.invoiceDate.slice(0, 4));
  if (!Number.isInteger(taxYear) || taxYear < 1000) {
    throw new Error(`Invalid invoice date: ${data.invoiceDate}`);
  }

  const contentLimit = invoiceContentLimitMessage({
    items: data.items,
    notes: data.notes,
  });
  if (contentLimit) throw new Error(contentLimit);

  const totalSign = documentTotalMustBePositiveMessage({
    documentType,
    total: data.total,
    items: data.items,
  });
  if (totalSign) throw new Error(totalSign);

  const payments = (data.payments ?? []) as PaymentEntry[];
  const paymentErr = validatePayments(
    payments,
    documentType,
    Number(data.total),
    data.currency ?? "ILS",
  );
  if (paymentErr) {
    throw new InvoicePaymentValidationError(paymentErr);
  }

  // Validate the parent reference for "receipt for invoice" flows.
  // Only RECEIPT documents may reference an invoice this way; the
  // parent must be a TAX_INVOICE owned by the same business entity,
  // currently issued or sent (not voided / draft), and not yet fully
  // paid. We compute outstanding the same way the issue path will
  // when it decides whether to flip the parent to `paid`:
  //   outstanding = (netOfCreditsAmount ?? total) - SUM(linked
  //                  receipts that are not voided)
  if (data.referencesDocumentId) {
    if (documentType === "RECEIPT") {
      // Receipt → Tax Invoice settlement link.
      const parent = await getReceiptParentForCreate(
        caller,
        data.referencesDocumentId,
        data.currency ?? "ILS",
      );
      const totalCents = Math.round(Number(data.total) * 100);
      const outstandingCents = Math.round(parent.outstandingAmount * 100);
      if (totalCents > outstandingCents) {
        throw new Error(
          `Receipt total ${data.total} exceeds outstanding balance ${parent.outstandingAmount.toFixed(2)} on invoice ${parent.formattedNumber}.`,
        );
      }
    } else if (documentType === "TAX_INVOICE") {
      // Tax invoice generated from a proforma or delivery note —
      // validate the source eligibility the same way the prefill page
      // does. Errors here are reachable via stale tabs / hand-typed
      // params, so a clear message is more useful than a 500.
      await getSourceForTaxInvoiceConversion(caller, data.referencesDocumentId);
    } else {
      throw new Error(
        `Document type ${documentType} cannot reference another document via referencesDocumentId.`,
      );
    }
  }

  // Drafts intentionally do NOT get a fiscal sequence number. Allocation
  // happens in `issueOutboundInvoiceOp` so that abandoned drafts can't
  // punch holes in the issued-invoice sequence (ITA Hora'ot Niho'ul
  // Pinkasei Cheshbonot — gap-free continuity applies to *issued* docs).
  // This is the established convention among Israeli invoicing systems.
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(outboundInvoices)
      .values({
        userId: caller.userId,
        businessEntityId: caller.businessEntityId,
        templateId: data.templateId || null,
        customerId: data.customerId || null,
        documentType,
        taxYear,
        sequenceNumber: null,
        formattedNumber: null,
        invoiceNumber: null,
        invoiceDate: data.invoiceDate,
        dueDate: data.dueDate || null,
        items: data.items,
        subtotal: data.subtotal,
        vatRate: data.vatRate ?? "18",
        vatAmount: data.vatAmount ?? "0",
        total: data.total,
        currency: data.currency ?? "ILS",
        language: data.language ?? "he",
        notes: data.notes || null,
        ...(data.customerEmail !== undefined
          ? { customerEmail: (data.customerEmail ?? "").trim() }
          : {}),
        payments,
        referencesDocumentId: data.referencesDocumentId || null,
        status: "draft",
      })
      .returning();

    await appendAuditEntry({
      tx,
      businessEntityId: caller.businessEntityId,
      userId: caller.userId,
      documentId: inserted.id,
      documentType,
      eventType: "CREATED",
      eventPayload: {
        sequenceNumber: null,
        formattedNumber: null,
        documentType,
        customerId: inserted.customerId ?? null,
        totalAmount: inserted.total,
        currency: inserted.currency ?? "ILS",
        taxYear,
      },
      actor: { userId: caller.userId },
    });

    return inserted;
  });

  // Fire-and-forget outside the transaction: the enqueue is best-effort
  // and must not fail the create if webhooks infra is down.
  void emitEvent({
    userId: caller.userId,
    eventType: "outbound_invoice.created",
    data: {
      outbound_invoice: {
        id: row.id,
        formatted_number: row.formattedNumber,
        document_type: row.documentType,
        status: row.status,
        total: row.total,
        currency: row.currency,
        customer_id: row.customerId,
      },
    },
  });

  return row;
}

export interface UpdateOutboundDraftInput {
  customerId?: string | null;
  invoiceDate?: string;
  dueDate?: string | null;
  items?: OutboundLineItem[];
  subtotal?: string;
  vatRate?: string;
  vatAmount?: string;
  total?: string;
  currency?: string;
  language?: string;
  notes?: string | null;
}

export async function updateOutboundInvoiceDraftOp(
  caller: CallerContext,
  id: string,
  patch: UpdateOutboundDraftInput,
) {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_CREATE_DRAFT,
    route: "updateOutboundInvoiceDraftOp",
  });

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.id, id),
          eq(outboundInvoices.businessEntityId, caller.businessEntityId),
          isNull(outboundInvoices.deletedAt),
        ),
      )
      .limit(1);

    if (!before) throw new Error("Invoice not found");
    if (before.status !== "draft") {
      throw new Error(
        `Cannot edit a document in status "${before.status}". ` +
          "Signed documents are immutable — issue a credit note instead (spec 06).",
      );
    }

    const contentLimit = invoiceContentLimitMessage({
      items: patch.items,
      notes: patch.notes,
    });
    if (contentLimit) throw new Error(contentLimit);

    const totalSign = documentTotalMustBePositiveMessage({
      documentType: before.documentType,
      total: patch.total ?? before.total,
      items: patch.items ?? before.items,
    });
    if (totalSign) throw new Error(totalSign);

    const [updated] = await tx
      .update(outboundInvoices)
      .set({
        ...patch,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboundInvoices.id, id),
          eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        ),
      )
      .returning();

    const changedFields = diffFields(
      pickEditable(before),
      pickEditable(updated),
    );

    if (Object.keys(changedFields).length > 0) {
      await appendAuditEntry({
        tx,
        businessEntityId: caller.businessEntityId,
        userId: caller.userId,
        documentId: id,
        documentType: updated.documentType,
        eventType: "UPDATED",
        eventPayload: {
          changedFields,
          version: updated.version,
        },
        actor: { userId: caller.userId },
      });
    }

    return updated;
  });
}

/**
 * Validate a `referencesDocumentId` candidate for a new RECEIPT and
 * return the parent's outstanding balance + display number. Throws a
 * user-facing error on every failure mode (not found, wrong type,
 * wrong status, mismatched currency, already fully paid).
 *
 * Outstanding = (net_of_credits_amount ?? total) - SUM of issued/sent/
 * paid receipts that already point at this invoice. Voided receipts
 * are excluded so a mistakenly-issued-then-voided receipt doesn't
 * leave the parent permanently un-settleable.
 */
export async function getReceiptParentForCreate(
  caller: CallerContext,
  parentInvoiceId: string,
  /**
   * When provided, validate that the receipt's currency matches the
   * parent's. The "Issue Receipt for invoice" page calls this without
   * a currency to discover the parent's currency for prefill; the
   * create operation calls it with the user's submitted currency to
   * gate the actual write.
   */
  receiptCurrency?: string,
): Promise<{
  id: string;
  formattedNumber: string;
  total: number;
  outstandingAmount: number;
  customerId: string | null;
  currency: string;
}> {
  const [parent] = await db
    .select({
      id: outboundInvoices.id,
      formattedNumber: outboundInvoices.formattedNumber,
      documentType: outboundInvoices.documentType,
      status: outboundInvoices.status,
      total: outboundInvoices.total,
      netOfCreditsAmount: outboundInvoices.netOfCreditsAmount,
      currency: outboundInvoices.currency,
      customerId: outboundInvoices.customerId,
      businessEntityId: outboundInvoices.businessEntityId,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.id, parentInvoiceId),
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .limit(1);
  if (!parent) {
    throw new Error("Parent invoice not found.");
  }
  if (parent.documentType !== "TAX_INVOICE") {
    throw new Error(
      "A receipt can only reference a tax invoice. " +
        `This document is a ${parent.documentType}.`,
    );
  }
  if (parent.status !== "issued" && parent.status !== "sent") {
    throw new Error(
      `Cannot issue a receipt for an invoice in status "${parent.status}".`,
    );
  }
  if (
    receiptCurrency &&
    (parent.currency ?? "ILS").toUpperCase() !== receiptCurrency.toUpperCase()
  ) {
    throw new Error(
      `Receipt currency (${receiptCurrency}) must match the invoice currency (${parent.currency ?? "ILS"}).`,
    );
  }
  if (!parent.formattedNumber) {
    // Defense: an issued/sent row should always have a number per the
    // 0010 CHECK constraint; surface a clear error if invariants slip.
    throw new Error("Parent invoice has no formatted number.");
  }

  const baseRemaining = Number(parent.netOfCreditsAmount ?? parent.total);
  const linkedReceipts = await db
    .select({
      total: outboundInvoices.total,
      status: outboundInvoices.status,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.referencesDocumentId, parent.id),
        eq(outboundInvoices.documentType, "RECEIPT"),
        isNull(outboundInvoices.deletedAt),
      ),
    );
  const settledByReceipts = linkedReceipts
    .filter((r) => r.status !== "voided" && r.status !== "draft")
    .reduce((sum, r) => sum + Number(r.total), 0);

  const outstandingAmount = Math.max(0, baseRemaining - settledByReceipts);
  if (outstandingAmount <= 0) {
    throw new Error(
      `Invoice ${parent.formattedNumber} has no outstanding balance.`,
    );
  }

  return {
    id: parent.id,
    formattedNumber: parent.formattedNumber,
    total: Number(parent.total),
    outstandingAmount,
    customerId: parent.customerId,
    currency: parent.currency ?? "ILS",
  };
}

/**
 * Validate a `fromSourceId` candidate for the "convert to tax invoice"
 * flow and return the prefill bundle: customer, items, currency,
 * language, plus a stable display number for the banner. Throws on
 * every ineligibility (not found, wrong type, wrong status, foreign
 * business entity, deleted).
 *
 * The two sources we accept are PROFORMA (price quote / חשבון עסקה /
 * הצעת מחיר) and DELIVERY_NOTE (תעודת משלוח). Both can legally precede
 * a tax invoice and the resulting TAX_INVOICE row carries a back-link
 * via `references_document_id` so the parent's detail page can flag
 * "already invoiced" once the conversion completes.
 */
export async function getSourceForTaxInvoiceConversion(
  caller: CallerContext,
  sourceId: string,
): Promise<{
  id: string;
  formattedNumber: string;
  documentType: "PROFORMA" | "DELIVERY_NOTE";
  customerId: string | null;
  items: OutboundLineItem[];
  subtotal: string;
  vatRate: string | null;
  vatAmount: string | null;
  total: string;
  currency: string;
  language: string;
}> {
  const [source] = await db
    .select({
      id: outboundInvoices.id,
      documentType: outboundInvoices.documentType,
      status: outboundInvoices.status,
      formattedNumber: outboundInvoices.formattedNumber,
      customerId: outboundInvoices.customerId,
      items: outboundInvoices.items,
      subtotal: outboundInvoices.subtotal,
      vatRate: outboundInvoices.vatRate,
      vatAmount: outboundInvoices.vatAmount,
      total: outboundInvoices.total,
      currency: outboundInvoices.currency,
      language: outboundInvoices.language,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.id, sourceId),
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .limit(1);
  if (!source) {
    throw new Error("Source document not found.");
  }
  if (
    source.documentType !== "PROFORMA" &&
    source.documentType !== "DELIVERY_NOTE"
  ) {
    throw new Error(
      `Cannot convert a ${source.documentType} into a tax invoice — only PROFORMA or DELIVERY_NOTE are valid sources.`,
    );
  }
  if (source.status !== "issued" && source.status !== "sent") {
    throw new Error(
      `Source document must be issued before it can be converted (current status: ${source.status}).`,
    );
  }
  if (!source.formattedNumber) {
    throw new Error("Source document has no formatted number.");
  }
  return {
    id: source.id,
    formattedNumber: source.formattedNumber,
    documentType: source.documentType as "PROFORMA" | "DELIVERY_NOTE",
    customerId: source.customerId,
    items: (source.items ?? []) as OutboundLineItem[],
    subtotal: source.subtotal,
    vatRate: source.vatRate,
    vatAmount: source.vatAmount,
    total: source.total,
    currency: source.currency ?? "ILS",
    language: source.language ?? "he",
  };
}

/**
 * Recompute the parent invoice's outstanding balance after a linked
 * receipt has been issued and flip it to `paid` when the balance is
 * settled (within a one-cent tolerance to absorb decimal drift). Idempotent
 * — calling this twice for the same receipt is a no-op because the
 * second computation includes the first issue, which only matters when
 * the balance is already zero. Audit entry recorded on the parent.
 *
 * If the issuance was a partial payment, the parent stays in its current
 * status (`issued` or `sent`); the seller can issue more receipts until
 * the balance clears.
 */
async function settleParentInvoiceFromReceipt(params: {
  parentInvoiceId: string;
  businessEntityId: string;
  actorUserId: string;
  receiptId: string;
  receiptFormattedNumber: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [parent] = await tx
      .select({
        id: outboundInvoices.id,
        documentType: outboundInvoices.documentType,
        status: outboundInvoices.status,
        total: outboundInvoices.total,
        netOfCreditsAmount: outboundInvoices.netOfCreditsAmount,
        formattedNumber: outboundInvoices.formattedNumber,
        currency: outboundInvoices.currency,
      })
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.id, params.parentInvoiceId),
          eq(outboundInvoices.businessEntityId, params.businessEntityId),
        ),
      )
      .limit(1);
    if (!parent) return;
    if (parent.status === "paid" || parent.status === "voided") return;

    const linkedReceipts = await tx
      .select({
        total: outboundInvoices.total,
        status: outboundInvoices.status,
      })
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.referencesDocumentId, parent.id),
          eq(outboundInvoices.documentType, "RECEIPT"),
          isNull(outboundInvoices.deletedAt),
        ),
      );
    const settledByReceipts = linkedReceipts
      .filter((r) => r.status !== "voided" && r.status !== "draft")
      .reduce((sum, r) => sum + Number(r.total), 0);

    const baseRemaining = Number(parent.netOfCreditsAmount ?? parent.total);
    const outstandingCents = Math.round((baseRemaining - settledByReceipts) * 100);
    if (outstandingCents > 0) return;

    await tx
      .update(outboundInvoices)
      .set({
        status: "paid",
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(outboundInvoices.id, parent.id));

    await appendAuditEntry({
      tx,
      businessEntityId: params.businessEntityId,
      userId: params.actorUserId,
      documentId: parent.id,
      documentType: parent.documentType,
      eventType: "STATUS_CHANGED",
      eventPayload: {
        from: parent.status,
        to: "paid",
        reason: "settled_by_receipt",
        receiptId: params.receiptId,
        receiptFormattedNumber: params.receiptFormattedNumber,
      },
      actor: { userId: params.actorUserId },
    });
  });
}

/**
 * The mirror of `settleParentInvoiceFromReceipt`: when a linked receipt
 * is voided, the payment it represented no longer settles anything, so a
 * parent that was flipped to `paid` has to reopen.
 *
 * Without this, voiding a receipt left the parent stuck at `paid`
 * forever — nothing else demotes it — and `getReceiptParentForCreate`
 * refuses any parent that is not `issued` / `sent`. The seller was then
 * unable to issue a replacement receipt for an invoice that is, in fact,
 * unpaid again.
 *
 * Restores `sent` when the invoice was ever emailed (`sentAt`) and
 * `issued` otherwise, so the reopen does not silently forget a delivery.
 * Only reopens when the remaining balance is actually positive: a
 * partially-credited invoice settled by several receipts stays `paid`
 * while the others still cover it.
 *
 * Like its counterpart this writes the status directly rather than going
 * through `ALLOWED_STATUS_TRANSITIONS`, which governs seller-initiated
 * changes; this is a system-computed correction to a derived field.
 */
async function reopenParentInvoiceFromVoidedReceipt(params: {
  parentInvoiceId: string;
  businessEntityId: string;
  actorUserId: string;
  receiptId: string;
  receiptFormattedNumber: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [parent] = await tx
      .select({
        id: outboundInvoices.id,
        documentType: outboundInvoices.documentType,
        status: outboundInvoices.status,
        total: outboundInvoices.total,
        netOfCreditsAmount: outboundInvoices.netOfCreditsAmount,
        formattedNumber: outboundInvoices.formattedNumber,
        sentAt: outboundInvoices.sentAt,
      })
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.id, params.parentInvoiceId),
          eq(outboundInvoices.businessEntityId, params.businessEntityId),
        ),
      )
      .limit(1);
    if (!parent) return;
    // Only `paid` is ours to undo. A voided parent stays voided.
    if (parent.status !== "paid") return;

    const linkedReceipts = await tx
      .select({
        total: outboundInvoices.total,
        status: outboundInvoices.status,
      })
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.referencesDocumentId, parent.id),
          eq(outboundInvoices.documentType, "RECEIPT"),
          isNull(outboundInvoices.deletedAt),
        ),
      );
    const settledByReceipts = linkedReceipts
      .filter((r) => r.status !== "voided" && r.status !== "draft")
      .reduce((sum, r) => sum + Number(r.total), 0);

    const baseRemaining = Number(parent.netOfCreditsAmount ?? parent.total);
    const outstandingCents = Math.round((baseRemaining - settledByReceipts) * 100);
    if (outstandingCents <= 0) return;

    const restored = parent.sentAt ? "sent" : "issued";
    await tx
      .update(outboundInvoices)
      .set({
        status: restored,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(outboundInvoices.id, parent.id));

    await appendAuditEntry({
      tx,
      businessEntityId: params.businessEntityId,
      userId: params.actorUserId,
      documentId: parent.id,
      documentType: parent.documentType,
      eventType: "STATUS_CHANGED",
      eventPayload: {
        from: parent.status,
        to: restored,
        reason: "reopened_by_voided_receipt",
        receiptId: params.receiptId,
        receiptFormattedNumber: params.receiptFormattedNumber,
        outstandingAmount: (outstandingCents / 100).toFixed(2),
      },
      actor: { userId: params.actorUserId },
    });
  });
}

function pickEditable(row: typeof outboundInvoices.$inferSelect) {
  return {
    customerId: row.customerId,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    items: row.items,
    subtotal: row.subtotal,
    vatRate: row.vatRate,
    vatAmount: row.vatAmount,
    total: row.total,
    currency: row.currency,
    language: row.language,
    notes: row.notes,
  } as Record<string, unknown>;
}

export async function updateOutboundInvoiceStatusOp(
  caller: CallerContext,
  id: string,
  status: OutboundInvoiceStatus,
) {
  if (status === "issued") {
    throw new Error(
      "Use issueOutboundInvoiceOp() to transition a draft to issued — this path signs the document.",
    );
  }
  const permission =
    status === "voided"
      ? PERMISSIONS.DOCUMENT_VOID
      : PERMISSIONS.DOCUMENT_CREATE_DRAFT;
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission,
    route: "updateOutboundInvoiceStatusOp",
  });

  const result = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.id, id),
          eq(outboundInvoices.businessEntityId, caller.businessEntityId),
          isNull(outboundInvoices.deletedAt),
        ),
      )
      .limit(1);

    if (!before) throw new Error("Invoice not found");
    if (before.status === status) return { updated: before, emit: false };

    const legal =
      ALLOWED_STATUS_TRANSITIONS[before.status as OutboundInvoiceStatus];
    if (!legal || !legal.has(status)) {
      throw new Error(
        `Illegal status transition: ${before.status} → ${status}.` +
          (before.status === "draft" && status === "voided"
            ? before.formattedNumber
              ? ` This draft holds number ${before.formattedNumber}; cancel it from the Tax Authority refusal options instead.`
              : " Discard the draft instead."
            : ""),
      );
    }
    if (
      status === "voided" &&
      !canCancelWithoutCreditNote(before.documentType)
    ) {
      throw new CannotVoidDocumentTypeError(before.documentType);
    }

    const [updated] = await tx
      .update(outboundInvoices)
      .set({
        status,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboundInvoices.id, id),
          eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        ),
      )
      .returning();

    const eventType = status === "voided" ? "VOIDED" : "STATUS_CHANGED";
    await appendAuditEntry({
      tx,
      businessEntityId: caller.businessEntityId,
      userId: caller.userId,
      documentId: id,
      documentType: updated.documentType,
      eventType,
      eventPayload:
        status === "voided"
          ? {
              reason: "status_transition",
              previousStatus: before.status,
              formattedNumber: before.formattedNumber,
            }
          : {
              from: before.status,
              to: status,
              version: updated.version,
            },
      actor: { userId: caller.userId },
    });

    return { updated, emit: true };
  });

  // Voiding a receipt un-settles whatever it paid for. Outside the
  // transaction and non-fatal, matching the settle side on the issue
  // path: the void itself must stand even if the reopen fails, and the
  // parent can be reconciled afterwards.
  if (
    result.emit &&
    status === "voided" &&
    result.updated.documentType === "RECEIPT" &&
    result.updated.referencesDocumentId
  ) {
    try {
      await reopenParentInvoiceFromVoidedReceipt({
        parentInvoiceId: result.updated.referencesDocumentId,
        businessEntityId: caller.businessEntityId,
        actorUserId: caller.userId,
        receiptId: result.updated.id,
        receiptFormattedNumber: result.updated.formattedNumber ?? "",
      });
    } catch (reopenErr) {
      console.error(
        `[void] reopenParentInvoiceFromVoidedReceipt failed for receipt=${result.updated.id} parent=${result.updated.referencesDocumentId}:`,
        reopenErr,
      );
    }
  }

  if (result.emit) {
    const event =
      status === "paid"
        ? "outbound_invoice.paid"
        : status === "voided"
          ? "outbound_invoice.voided"
          : status === "sent"
            ? "outbound_invoice.sent"
            : null;
    if (event) {
      void emitEvent({
        userId: caller.userId,
        eventType: event,
        data: {
          outbound_invoice: {
            id: result.updated.id,
            formatted_number: result.updated.formattedNumber,
            document_type: result.updated.documentType,
            status: result.updated.status,
            total: result.updated.total,
            currency: result.updated.currency,
          },
        },
      });
    }
  }

  return result.updated;
}

export async function deleteOutboundInvoiceOp(
  caller: CallerContext,
  id: string,
) {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_CREATE_DRAFT,
    route: "deleteOutboundInvoiceOp",
  });

  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.id, id),
          eq(outboundInvoices.businessEntityId, caller.businessEntityId),
          isNull(outboundInvoices.deletedAt),
        ),
      )
      .limit(1);

    if (!before) throw new Error("Invoice not found");
    if (before.status !== "draft") {
      throw new Error(
        "Cannot delete a document that has been issued. Issue a credit note instead.",
      );
    }
    // A draft that already holds a fiscal number (spent by an issue the
    // Tax Authority refused or never answered) cannot just disappear: that
    // would leave a gap in the numbering explained only by an audit entry.
    // It is issued, or cancelled through the refusal options, which record
    // why the number was spent.
    if (before.formattedNumber) {
      throw new Error(
        `Cannot delete a document that holds number ${before.formattedNumber}. Issue it, or cancel it from the Tax Authority refusal options.`,
      );
    }

    const now = new Date();
    // Soft-delete only. Keep status = "draft": flipping a numberless draft to
    // "voided" violates the `outbound_invoices_issued_has_number` check
    // constraint (any non-draft status requires a sequence number, which a
    // draft never has). The `deletedAt` marker alone hides the row — every
    // read path filters `isNull(deletedAt)`.
    await tx
      .update(outboundInvoices)
      .set({
        deletedAt: now,
        deletedBy: caller.userId,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(outboundInvoices.id, id),
          eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        ),
      );

    await appendAuditEntry({
      tx,
      businessEntityId: caller.businessEntityId,
      userId: caller.userId,
      documentId: id,
      documentType: before.documentType,
      eventType: "VOIDED",
      eventPayload: {
        reason: "draft_deleted",
        previousStatus: before.status,
        formattedNumber: before.formattedNumber,
      },
      actor: { userId: caller.userId },
    });
  });
}

export interface SendOutboundInvoiceByEmailInput {
  invoiceId: string;
  to: string;
  subject: string;
  body: string;
  /**
   * Bypass the SHAAM gate on PENDING / OUTAGE_ISSUED / REJECTED / HELD
   * docs. The seller acknowledges that the customer-facing PDF may not
   * include the allocation number; an audit entry records the override.
   */
  force?: boolean;
  /**
   * Attach the business's saved withholding-tax certificate as a second
   * PDF. Ignored when false. Fails the send when true and no file is saved.
   */
  attachWithholdingCertificate?: boolean;
  /**
   * Provenance tag for the audit log. `manual` (default) is the seller
   * pressing send; `auto_after_shaam_clear` is the cron firing a queued
   * delivery once SHAAM cleared.
   */
  source?: "manual" | "auto_after_shaam_clear";
}

export type SendOutboundInvoiceByEmailResult =
  | {
      success: true;
      messageId: string | null;
      newStatus: OutboundInvoiceStatus;
      sentAt: string;
    }
  | { success: false; error: string }
  | {
      /**
       * SHAAM gate refused the send. Caller can show "Send anyway" /
       * "Queue and auto-send when SHAAM clears" choices in the UI; the
       * REST API surfaces this as 409 with `{ code, can_force, can_queue }`.
       */
      success: false;
      shaamGate: ShaamGateState;
      shaamStatus: string;
      allocationNumber: string | null;
      error: string;
    };

export interface QueueOutboundInvoiceForDeliveryInput {
  invoiceId: string;
  to: string;
  subject: string;
  body: string;
  /** Remember the send-dialog choice until SHAAM clears. */
  attachWithholdingCertificate?: boolean;
}

export type QueueOutboundInvoiceForDeliveryResult =
  | { success: true; queued: true; queuedAt: string }
  | { success: false; error: string };

export type CancelQueuedDeliveryResult =
  | { success: true; cleared: boolean }
  | { success: false; error: string };

/**
 * SHAAM states that block an unforced send. PENDING + OUTAGE_ISSUED are
 * "still chasing"; REJECTED + HELD are "terminally bad" and need the
 * seller to either fix the data or knowingly send the interim PDF.
 *
 * ISSUED_WITHOUT_ALLOCATION is deliberately absent: the seller already
 * made that call explicitly through the rejection dialog, acknowledging
 * that the buyer cannot deduct VAT. Gating it again would ask the same
 * question twice.
 */
const SHAAM_GATE_BLOCKING_STATES = new Set([
  "PENDING",
  "OUTAGE_ISSUED",
  "REJECTED",
  "HELD",
  "UNRESOLVED",
] as const);
type ShaamGateState =
  | "PENDING"
  | "OUTAGE_ISSUED"
  | "REJECTED"
  | "HELD"
  | "UNRESOLVED";

/**
 * Email a signed outbound invoice to its customer with the PDF attached.
 *
 * Mirrors the Xero/FreshBooks/QuickBooks "send invoice" flow:
 *   1. PDF is rendered fresh (including the QR-coded verify footer) so
 *      every copy is auditable against the signed canonical JSON.
 *   2. SES sends a raw MIME message so the PDF attaches (`src/lib/email/
 *      send-invoice-email.ts`).
 *   3. On success: `sent_at` is stamped, and an `issued` invoice
 *      transitions to `sent` (firing `outbound_invoice.sent`).
 *      Re-sends from `sent`/`paid` refresh `sent_at` but leave status
 *      alone.
 *   4. A STATUS_CHANGED audit entry with `method: "email"` records the
 *      recipient and SES message id for the 7-year trail.
 *
 * Rejected: `draft` (not yet signed) and `voided` (no valid document to
 * deliver). `DOCUMENT_CREATE_DRAFT` gates this to match the existing
 * `issued → sent` transition permission.
 */
export async function sendOutboundInvoiceByEmailOp(
  caller: CallerContext,
  input: SendOutboundInvoiceByEmailInput,
): Promise<SendOutboundInvoiceByEmailResult> {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_CREATE_DRAFT,
    route: "sendOutboundInvoiceByEmailOp",
  });

  const to = input.to.trim();
  const subject = input.subject.trim();
  const body = input.body ?? "";

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { success: false, error: "Invalid recipient email address." };
  }
  if (!subject) {
    return { success: false, error: "Subject is required." };
  }

  const [row] = await db
    .select()
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.id, input.invoiceId),
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return { success: false, error: "Invoice not found." };

  const currentStatus = (row.status ?? "draft") as OutboundInvoiceStatus;
  if (currentStatus === "draft") {
    return {
      success: false,
      error: "Issue the invoice before sending — drafts cannot be emailed.",
    };
  }
  if (currentStatus === "voided") {
    return { success: false, error: "Voided invoices cannot be sent." };
  }
  // Past the draft gate, the row MUST carry a fiscal number — the
  // `outbound_invoices_issued_has_number` CHECK enforces this at the
  // DB level. Narrow for TypeScript and surface a clear error if a
  // legacy row somehow slips through.
  if (row.formattedNumber == null) {
    return {
      success: false,
      error: `Invoice ${row.id} is in status "${currentStatus}" without a fiscal number — refusing to send.`,
    };
  }
  const sendFormattedNumber = row.formattedNumber;

  // SHAAM gate. PENDING / OUTAGE_ISSUED / REJECTED / HELD all withhold
  // the send by default — the customer-facing PDF would either be the
  // interim version (no allocation number) or the doc would be in a
  // terminal-bad state. The seller can override with `force: true`,
  // which is audit-logged. Auto-sends from the cron pass `force: true`
  // because they're firing a queued delivery the seller already opted
  // into.
  if (
    SHAAM_GATE_BLOCKING_STATES.has(row.shaamStatus as ShaamGateState) &&
    !input.force
  ) {
    const gateState = row.shaamStatus as ShaamGateState;
    return {
      success: false,
      shaamGate: gateState,
      shaamStatus: row.shaamStatus,
      allocationNumber: row.allocationNumber ?? null,
      error: shaamGateMessage(gateState),
    };
  }

  // The file stored at issue (replaced when an allocation number is
  // stamped) is the document the customer receives. Render only when
  // that file was never published.
  const [signatureRow] = await db
    .select()
    .from(documentSignatures)
    .where(eq(documentSignatures.documentId, row.id))
    .limit(1);

  const entity = await getBusinessEntityForUser(caller.userId);
  const issuer =
    signatureRow && signatureRow.canonicalJson
      ? buildIssuerIdentityFromCanonical(
          signatureRow.canonicalJson as CanonicalDocument,
        )
      : buildIssuerIdentityFromEntity(entity);

  const [seller] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, caller.userId))
    .limit(1);

  const [template] = row.templateId
    ? await db
        .select()
        .from(invoiceTemplates)
        .where(eq(invoiceTemplates.id, row.templateId))
        .limit(1)
    : await db
        .select()
        .from(invoiceTemplates)
        .where(
          and(
            eq(invoiceTemplates.userId, caller.userId),
            eq(invoiceTemplates.isDefault, true),
          ),
        )
        .limit(1);

  const [customer] = row.customerId
    ? await db
        .select()
        .from(customers)
        .where(eq(customers.id, row.customerId))
        .limit(1)
    : [];

  // PDF rendering runs through Puppeteer with no session cookie, so
  // the same-origin logo proxy can't authenticate the request — inline
  // the bytes as a data: URL.
  const resolvedLogoUrl = await resolveTemplateLogo(template?.logoUrl ?? null, {
    embedAsDataUrl: true,
  });

  const config: TemplateConfig = buildTemplateConfig({
    template,
    issuer,
    logoUrl: resolvedLogoUrl,
  });

  // Issued before rates were frozen: print at the latest stored BOI rate.
  if (row.fxRateToIls == null) await ensureFreshRateToIls(row.currency);
  const invoiceData: InvoiceData = {
    invoiceNumber: sendFormattedNumber,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate ?? undefined,
    customerName: customer?.name ?? "—",
    customerEmail: printedCustomerEmail(row.customerEmail, customer?.email),
    customerAddress: customer?.address ?? undefined,
    customerTaxId: customer?.taxId ?? undefined,
    items: row.items,
    subtotal: Number(row.subtotal),
    vatRate: Number(row.vatRate ?? 18),
    vatAmount: Number(row.vatAmount ?? 0),
    total: Number(row.total),
    currency: row.currency ?? "ILS",
    language: row.language ?? "he",
    notes: row.notes ?? undefined,
    allocationNumber: row.allocationNumber ?? null,
    issuedWithoutAllocation:
      row.shaamStatus === "ISSUED_WITHOUT_ALLOCATION",
    documentType: row.documentType,
    payments: (row.payments ?? []) as PaymentEntry[],
    reverseCharge: row.reverseCharge,
    fxRateToIls: row.fxRateToIls,
    copyMarker: "original",
  };

  // The first email takes the מקור file. A later email takes the
  // certified copy. Render only when that file was never stored.
  const handed = await handOutStoredInvoicePdf({
    invoiceId: row.id,
    pdfUrl: row.pdfUrl,
    ownerUserId: row.userId,
  });
  let pdfBuffer: Buffer;
  if (handed.ok) {
    pdfBuffer = handed.buffer;
  } else {
    const sendStamp = await loadPdfSignatureStamp(row.id);
    const asCopy = handed.reason === "missing_copy";
    try {
      const { buffer } = await generateInvoicePdf(
        config,
        withForeignExchangeDisplay({
          ...invoiceData,
          copyMarker: asCopy ? "copy" : "original",
        }),
        {
          isDraft: false,
          signature: sendStamp ?? undefined,
        },
      );
      pdfBuffer = buffer;
      if (asCopy) {
        await uploadFile(buffer, handed.copyKey, "application/pdf");
      } else {
        let copyBuffer: Buffer | undefined;
        try {
          const copy = await generateInvoicePdf(
            config,
            withForeignExchangeDisplay({ ...invoiceData, copyMarker: "copy" }),
            { isDraft: false, signature: sendStamp ?? undefined },
          );
          copyBuffer = copy.buffer;
        } catch (copyErr) {
          console.error(
            `[send] certified copy render failed for ${row.id}:`,
            copyErr,
          );
        }
        await publishIssuedPdf({
          invoiceId: row.id,
          userId: row.userId,
          formattedNumber: sendFormattedNumber,
          pdfBuffer: buffer,
          copyBuffer,
          updatePdfUrlRow: true,
        });
        const won = await claimOriginalRelease(row.id);
        if (!won && copyBuffer) pdfBuffer = copyBuffer;
      }
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? `PDF generation failed: ${err.message}`
            : "PDF generation failed.",
      };
    }
  }

  const replyTo = resolveReplyToAddress(
    template?.businessEmail,
    seller?.email ?? entity.email,
  );

  let extraAttachments:
    | { filename: string; content: Buffer; contentType: string }[]
    | undefined;
  if (input.attachWithholdingCertificate) {
    let certificate: { filename: string; content: Buffer } | null = null;
    try {
      certificate = await readWithholdingCertificate(entity);
    } catch {
      certificate = null;
    }
    if (!certificate) {
      return {
        success: false,
        error:
          "The withholding-tax certificate is no longer saved. Uncheck it and send again.",
      };
    }
    extraAttachments = [
      {
        filename: certificate.filename,
        content: certificate.content,
        contentType: "application/pdf",
      },
    ];
  }

  const sendResult = await sendInvoiceEmail({
    to,
    subject,
    bodyText: body,
    replyTo,
    attachment: {
      filename: `invoice-${row.formattedNumber}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    },
    extraAttachments,
  });

  if (!sendResult.ok) {
    return { success: false, error: sendResult.error };
  }

  const shouldTransition = currentStatus === "issued";
  const newStatus: OutboundInvoiceStatus = shouldTransition
    ? "sent"
    : currentStatus;
  const sentAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(outboundInvoices)
      .set({
        sentAt,
        ...(shouldTransition ? { status: "sent" as const } : {}),
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: sentAt,
      })
      .where(
        and(
          eq(outboundInvoices.id, row.id),
          eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        ),
      );

    await appendAuditEntry({
      tx,
      businessEntityId: caller.businessEntityId,
      userId: caller.userId,
      documentId: row.id,
      documentType: row.documentType,
      eventType: "STATUS_CHANGED",
      eventPayload: {
        method: "email",
        recipient: to,
        subject,
        sesMessageId: sendResult.messageId,
        from: currentStatus,
        to: newStatus,
        formattedNumber: row.formattedNumber,
        forced: Boolean(input.force),
        source: input.source ?? "manual",
        shaamStatusAtSend: row.shaamStatus,
        allocationNumberAtSend: row.allocationNumber ?? null,
        pdfKindAtSend: row.pdfKind,
        withholdingCertificateAttached: Boolean(input.attachWithholdingCertificate),
      },
      actor: { userId: caller.userId },
    });
  });

  if (shouldTransition) {
    void emitEvent({
      userId: caller.userId,
      eventType: "outbound_invoice.sent",
      data: {
        outbound_invoice: {
          id: row.id,
          formatted_number: row.formattedNumber,
          document_type: row.documentType,
          status: newStatus,
          total: row.total,
          currency: row.currency,
          recipient: to,
        },
      },
    });
  }

  return {
    success: true,
    messageId: sendResult.messageId,
    newStatus,
    sentAt: sentAt.toISOString(),
  };
}

export async function updateOutboundInvoicePdfUrlOp(
  caller: CallerContext,
  id: string,
  pdfUrl: string,
) {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_VIEW,
    route: "updateOutboundInvoicePdfUrlOp",
  });
  await db
    .update(outboundInvoices)
    .set({
      pdfUrl,
      version: sql`${outboundInvoices.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outboundInvoices.id, id),
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        isNull(outboundInvoices.deletedAt),
      ),
    );
}

/**
 * Publish the issued PDF to the operational object store so the public
 * `GET /api/v1/outbound-invoices/{id}/pdf` endpoint can mint a presigned
 * download URL for it.
 *
 * The archive bucket is COMPLIANCE-locked and intended only for the
 * 7-year audit trail; we deliberately keep customer-facing downloads on
 * the regular bucket. The key shape matches the legacy web flow
 * (`{userId}/invoices-pdf/{formatted_number}.pdf`) so a single document
 * has a stable storage location across re-renders (e.g. an inline SHAAM
 * approval that re-archives a final PDF with the allocation number).
 *
 * `updatePdfUrlRow` is true on first publish (writes the storage key
 * onto the invoice row) and false on subsequent overwrites where the
 * key is unchanged — saves a redundant version bump.
 */
async function publishIssuedPdf(args: {
  invoiceId: string;
  userId: string;
  formattedNumber: string;
  pdfBuffer: Buffer;
  /** Certified copy frozen beside the original. Optional so a failed copy render still publishes מקור. */
  copyBuffer?: Buffer;
  updatePdfUrlRow: boolean;
}): Promise<void> {
  const key = `${args.userId}/invoices-pdf/${args.formattedNumber}.pdf`;
  await uploadFile(args.pdfBuffer, key, "application/pdf");
  if (args.copyBuffer) {
    await storeIssuedCopyPdf(key, args.copyBuffer);
  }
  if (!args.updatePdfUrlRow) return;
  await db
    .update(outboundInvoices)
    .set({
      pdfUrl: key,
      version: sql`${outboundInvoices.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(outboundInvoices.id, args.invoiceId));
}

export interface IssueResult {
  success: true;
  formattedNumber: string;
  signedAt: Date;
  keyId: string;
  archiveChainSequence: number;
  shaamStatus: string | null;
  allocationNumber: string | null;
  /**
   * Route B: the refused invoice was replaced by a new zero-VAT invoice,
   * and this result is that invoice's. The caller should show it.
   */
  replacementInvoiceId?: string;
}

export interface IssueFailure {
  success: false;
  error: string;
  /** Route B: the replacement invoice this failure is about, when one was created. */
  replacementInvoiceId?: string;
  /**
   * Set when SHAAM validation rejected the issuance (Pattern C — REJECTED
   * or HELD response). Lets the caller present a different UI than for
   * generic failures (the seller likely needs to fix the data).
   */
  shaamRejection?: "REJECTED" | "HELD";
  /**
   * The ITA's own error code and the statutory options that apply to it.
   * Populated alongside `shaamRejection` so the caller can render the
   * decision dialog without a second round-trip.
   */
  shaamErrorCode?: string | null;
  shaamRejectionKind?: ShaamRejectionKind;
  shaamRejectionOptions?: ShaamRejectionOption[];
  /** i18n key suffix under `shaamSubmission.rejection.reason.*`, or null. */
  shaamRejectionReasonKey?: string | null;
  /** מועד השימוע (ISO) when the ITA returned one with a hold. */
  shaamHearingDeadline?: string | null;
  /** Printed date would precede the previous document of this type. */
  dateOrder?: true;
  /**
   * Set when the per-customer daily issuance cap blocked this document.
   * Typed rather than string-matched so the REST layer can answer 429
   * (with the numbers) instead of falling through to a generic 500.
   */
  customerDailyLimit?: { limit: number; issuedToday: number };
  /** Set when creation is closed pending ITA software approval. */
  documentsLocked?: true;
  /**
   * The document needs an allocation number and the customer has no usable
   * licensed-dealer number to request it with. Nothing was allocated.
   */
  customerTaxIdRequired?: true;
  /** A reverse-charge draft whose consent or VAT no longer allows issuing it. */
  reverseChargeBlocked?: true;
  /** Narrows `reverseChargeBlocked`: the buyer just has not signed yet. */
  reverseChargePendingSignature?: true;
  /** Route B: the ITA refused the action-3 request itself. Nothing was issued. */
  reverseChargeRefusedByIta?: true;
  /**
   * A zero-VAT tax invoice from a business whose default is VAT-inclusive,
   * with no reverse charge. Legal (export, zero-rated supply) but more
   * often a mistake; issuing needs `confirmZeroVat` to say it is deliberate.
   */
  zeroVatConfirmationRequired?: true;
  /**
   * A voluntary allocation request was refused. The document does not
   * need a number, so issuance is paused for a yes/no: issue without
   * one, or cancel the reserved number. Not the statutory refusal dialog.
   */
  voluntaryAllocationDeclined?: true;
}

/**
 * Pattern C — sync-allocate-then-issue, with outage fallback.
 *
 * Order of operations:
 *   1. Compute signature inputs (in-memory only, no DB writes).
 *   2. Call SHAAM synchronously. Three outcomes:
 *      - APPROVED / NOT_REQUIRED → carry allocation forward; PDF will be `final`.
 *      - REJECTED / HELD → BLOCK issuance. Return a typed failure so the caller
 *        can show the SHAAM error message; the document stays in `draft`.
 *      - OUTAGE_ISSUED / PENDING → fall through; PDF is `interim`; admin email
 *        is sent fire-and-forget. Cron will chase the allocation later and the
 *        `regenerateAndArchiveFinalPdf` helper will flip `pdf_kind` to `final`.
 *   3. Render the PDF once (with allocation when present), archive it +
 *      signature + canonical JSON in a single tx, and update `pdfUrl` /
 *      `pdfKind` on the row from inside the same tx.
 *
 * The canonical JSON does not include the allocation number, so it's safe
 * to compute the signature before SHAAM responds — the same canonical doc
 * is signed regardless of which PDF flavor we end up archiving.
 */
export interface IssueOutboundInvoiceOptions {
  /**
   * What to do when the ITA refuses an allocation number.
   *
   * `block` (the default, and the behaviour every existing caller gets)
   * stops the issuance and hands the refusal back so the seller can
   * choose. `issue_without_allocation` is that choice coming back in:
   * the seller has seen the refusal, accepted that the buyer cannot
   * deduct input VAT, and asked for the document anyway.
   *
   * Passing `issue_without_allocation` speculatively — before a refusal
   * has actually happened — is harmless: the flag is only consulted on
   * the REJECTED/HELD branch.
   */
  onRejection?: "block" | "issue_without_allocation";
  /**
   * The caller has seen that this tax invoice carries no VAT, is not a
   * reverse charge, and comes from a business that normally charges VAT —
   * and wants it issued anyway (export, zero-rated supply). Without it,
   * that combination is refused with `zeroVatConfirmationRequired`.
   */
  confirmZeroVat?: boolean;
  /**
   * Ask the Tax Authority for an allocation number even though the
   * amount does not require one. A decline does not block issuance
   * by itself: the seller is asked, and only a yes continues.
   */
  requestAllocationAnyway?: boolean;
  /**
   * The seller was told a voluntary allocation request was refused
   * and chose to issue the document without a number.
   */
  confirmIssueWithoutAllocation?: boolean;
}

export async function issueOutboundInvoiceOp(
  caller: CallerContext,
  invoiceId: string,
  options: IssueOutboundInvoiceOptions = {},
): Promise<IssueResult | IssueFailure> {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_ISSUE,
    route: "issueOutboundInvoiceOp",
  });

  if (!(await canIssueOutboundDocument(caller.userId))) {
    return {
      success: false,
      error: OUTBOUND_DOCUMENTS_LOCKED_MESSAGE,
      documentsLocked: true,
    };
  }

  const [row] = await db
    .select({
      id: outboundInvoices.id,
      businessEntityId: outboundInvoices.businessEntityId,
      status: outboundInvoices.status,
      formattedNumber: outboundInvoices.formattedNumber,
      sequenceNumber: outboundInvoices.sequenceNumber,
      documentType: outboundInvoices.documentType,
      invoiceDate: outboundInvoices.invoiceDate,
      printedDate: outboundInvoices.printedDate,
      currency: outboundInvoices.currency,
      customerId: outboundInvoices.customerId,
      subtotal: outboundInvoices.subtotal,
      vatAmount: outboundInvoices.vatAmount,
      total: outboundInvoices.total,
      items: outboundInvoices.items,
      reverseCharge: outboundInvoices.reverseCharge,
      reverseChargeReplacesId: outboundInvoices.reverseChargeReplacesId,
      shaamStatus: outboundInvoices.shaamStatus,
      fxRateToIls: outboundInvoices.fxRateToIls,
      payments: outboundInvoices.payments,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.id, invoiceId),
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return { success: false, error: "Invoice not found" };
  if (row.status !== "draft") {
    return {
      success: false,
      error: `Only draft invoices can be issued (current status: ${row.status}).`,
    };
  }

  const totalSign = documentTotalMustBePositiveMessage({
    documentType: row.documentType,
    total: row.total,
    items: row.items,
  });
  if (totalSign) return { success: false, error: totalSign };

  // A zero-VAT tax invoice is a lawful document (Osek Patur, export,
  // zero-rated supply) — but from a business whose default is to charge
  // VAT it is far more often a toggle left off by mistake, and nothing
  // downstream will catch it: zero-VAT documents are excused from the
  // allocation flow entirely. So the server demands the mistake be ruled
  // out explicitly rather than trusting whatever VAT figures the client
  // sent. Reverse-charge drafts are exempt — their zero VAT rests on the
  // buyer's signed consent, checked below.
  if (
    (row.documentType === "TAX_INVOICE" ||
      row.documentType === "TAX_INVOICE_RECEIPT") &&
    !row.reverseCharge &&
    compareMoney(row.vatAmount ?? "0", "0") === 0 &&
    compareMoney(row.subtotal ?? "0", "0") !== 0 &&
    options.confirmZeroVat !== true
  ) {
    const [entity] = await db
      .select({ defaultVatInclusive: businessEntities.defaultVatInclusive })
      .from(businessEntities)
      .where(eq(businessEntities.id, row.businessEntityId))
      .limit(1);
    if (entity?.defaultVatInclusive) {
      return {
        success: false,
        zeroVatConfirmationRequired: true,
        error:
          "This tax invoice carries no VAT (0%), but this business normally charges VAT. If that is intended (export, zero-rated supply), confirm issuing without VAT; a reverse charge instead needs the buyer's signed consent via the reverse-charge panel.",
      };
    }
  }

  // Route B: reverse charge on an invoice the ITA refused or holds. The
  // refused invoice is not issued again; a new zero-VAT invoice replaces it
  // (spec §2.2.2), gets its own number, and asks for the special allocation
  // number under the refused invoice's Invoice_Id (action 3). The refused
  // one is cancelled when that number arrives. Issuing the original is how
  // the seller asks for this, so it creates — or picks up — the
  // replacement and issues that.
  if (
    row.reverseCharge &&
    !row.reverseChargeReplacesId &&
    (row.shaamStatus === "REJECTED" || row.shaamStatus === "HELD")
  ) {
    const created = await createReverseChargeReplacementOp(caller, row.id);
    if (!created.success) {
      return { success: false, reverseChargeBlocked: true, error: created.error };
    }
    const issued = await issueOutboundInvoiceOp(caller, created.replacementId, options);
    return { ...issued, replacementInvoiceId: created.replacementId };
  }

  // The replacement itself: its original must still be the refused draft
  // it was created for. If the seller resolved the original another way in
  // the meantime, there is nothing left to replace.
  if (row.reverseChargeReplacesId) {
    const [original] = await db
      .select({
        status: outboundInvoices.status,
        shaamStatus: outboundInvoices.shaamStatus,
        formattedNumber: outboundInvoices.formattedNumber,
      })
      .from(outboundInvoices)
      .where(eq(outboundInvoices.id, row.reverseChargeReplacesId))
      .limit(1);
    if (
      !original ||
      original.status !== "draft" ||
      (original.shaamStatus !== "REJECTED" && original.shaamStatus !== "HELD")
    ) {
      return {
        success: false,
        reverseChargeBlocked: true,
        error: `The refused invoice${original?.formattedNumber ? ` ${original.formattedNumber}` : ""} this one replaces is no longer waiting on the Tax Authority's refusal. Delete this draft.`,
      };
    }
  }

  // Foreign currency: the rate this document is issued at. A document whose
  // number was already allocated keeps the rate frozen with it; a fresh
  // attempt takes today's Bank of Israel representative rate, frozen below
  // in the same transaction that allocates the number. Everything after
  // this — the allocation decision, the ITA amounts, the printed ILS
  // figures — uses this one rate.
  const docCurrency = (row.currency ?? "ILS").toUpperCase();
  const isForeignCurrency = docCurrency !== "ILS" && docCurrency !== "NIS";
  const keepsFrozenRate = Boolean(row.formattedNumber) && row.fxRateToIls != null;
  let issueFx: ResolvedRate | null = null;
  if (isForeignCurrency && !keepsFrozenRate) {
    try {
      issueFx = await resolveRateToIls(docCurrency);
    } catch (err) {
      // No BOI rate today and none ever stored: refuse rather than issue at
      // an invented rate. Nothing has been allocated yet.
      if (err instanceof FxRateUnavailableError) {
        return { success: false, error: err.message };
      }
      throw err;
    }
  }
  const fxRateForIssue = keepsFrozenRate ? row.fxRateToIls : issueFx ? String(issueFx.rate) : null;
  const fxRateNumber = fxRateForIssue == null ? null : Number(fxRateForIssue);

  // An invoice that needs an allocation number cannot get one without the
  // customer's licensed-dealer number. Refuse here, before the fiscal number
  // is allocated below: failing later would either burn a number or issue
  // a document without the allocation it needs. The create form already
  // blocks this; the check lives here so the detail page, the REST API and
  // MCP cannot go around it.
  const customerTaxId = row.customerId
    ? (
        await db
          .select({ taxId: customers.taxId })
          .from(customers)
          .where(eq(customers.id, row.customerId))
          .limit(1)
      )[0]?.taxId ?? null
    : null;
  const gateAmounts = allocationAmountsIls({ ...row, fxRateToIls: fxRateForIssue });
  if (
    customerTaxIdBlocksIssue({
      documentType: row.documentType,
      issueDate: new Date(
        `${row.printedDate ?? printedDateForIssue()}T00:00:00Z`,
      ),
      preVatAmount: gateAmounts.preVatAmount,
      vatAmount: gateAmounts.vatAmount,
      currency: gateAmounts.currency,
      customerTaxId,
    })
  ) {
    return {
      success: false,
      customerTaxIdRequired: true,
      error: customerTaxId?.trim()
        ? `The customer's tax ID "${customerTaxId.trim()}" is not a valid 9-digit Israeli licensed-dealer or company number. This invoice needs an allocation number from the Tax Authority, which cannot be requested without one. Fix the number on the customer and issue again.`
        : "This invoice needs an allocation number from the Tax Authority, which cannot be requested without the customer's 9-digit licensed-dealer or company number. Add it to the customer and issue again.",
    };
  }

  // The replacement of a refused invoice (route B) asks for the special
  // allocation number as action 3; everything else is a regular request.
  const shaamActionCode = row.reverseChargeReplacesId ? 3 : 1;

  // Reverse charge: the zero VAT is only lawful on the buyer's consent, so
  // that consent has to cover the document as it is being issued — not as
  // it was when the seller applied reverse charge. Checked before the
  // fiscal number is spent, and the consent archived alongside, since a
  // signed record that lives only in an editable row is weak evidence.
  if (row.reverseCharge) {
    const rc = await reverseChargeIssueCheck(row);
    if (!rc.ok) {
      return {
        success: false,
        reverseChargeBlocked: true,
        ...(rc.pendingSignature ? { reverseChargePendingSignature: true } : {}),
        error: rc.error,
      };
    }
    const archived = await archiveConsentEvidence({
      consentId: rc.consentId,
      actorUserId: caller.userId,
    });
    if (!archived.ok) {
      return {
        success: false,
        error: `Could not archive the buyer's reverse-charge consent: ${archived.error}`,
      };
    }
    await db
      .update(outboundInvoices)
      .set({ reverseChargeConsentId: rc.consentId })
      .where(eq(outboundInvoices.id, row.id));
  }

  const customerDailyLimit = await resolveOutboundCustomerDailyLimit(
    caller.businessEntityId,
  );

  // Allocate the gapless fiscal number now (drafts created via
  // `createOutboundInvoiceOp` carry NULL numbers). If a previous issue
  // attempt already allocated one but failed downstream (e.g. SHAAM
  // REJECTED, network blip), reuse it — the number is "spent" the
  // moment it leaves the sequence, so a retry must not burn another.
  //
  // The per-customer daily cap is checked INSIDE this transaction, before
  // the sequence is touched: the check locks the customer row, so two
  // concurrent issues to the same customer can't both squeak past the
  // limit, and a rejection rolls back without burning a number. A retry of
  // an already-allocated document skips the check — its slot was consumed
  // on the first attempt and must not be counted twice.
  const printedDate = row.printedDate ?? printedDateForIssue();
  let allocatedFormattedNumber: string;
  try {
    allocatedFormattedNumber = await db.transaction(async (tx) => {
      if (!row.printedDate) {
        await assertPrintedDateFollowsSeries(tx, {
          businessEntityId: caller.businessEntityId,
          documentType: row.documentType,
          printedDate,
          excludeDocumentId: invoiceId,
        });
      }
      if (row.formattedNumber && row.sequenceNumber != null) {
        if (!row.printedDate || issueFx) {
          await tx
            .update(outboundInvoices)
            .set({
              ...(!row.printedDate
                ? { printedDate, taxYear: Number(printedDate.slice(0, 4)) }
                : {}),
              // Allocated before rates were frozen: freeze now, once.
              ...(issueFx ? fxColumns(issueFx) : {}),
              updatedAt: new Date(),
            })
            .where(eq(outboundInvoices.id, invoiceId));
        }
        return row.formattedNumber;
      }
      await assertOutboundCustomerDailyLimitTx(tx, {
        businessEntityId: caller.businessEntityId,
        customerId: row.customerId,
        limit: customerDailyLimit,
      });
      const allocTaxYear = Number(printedDate.slice(0, 4));
      if (!Number.isInteger(allocTaxYear) || allocTaxYear < 1000) {
        throw new Error(`Invalid printed date: ${printedDate}`);
      }
      const alloc = await allocateDocumentNumberTx(tx, {
        businessEntityId: caller.businessEntityId,
        userId: caller.userId,
        documentType: row.documentType,
        taxYear: allocTaxYear,
      });
      await tx
        .update(outboundInvoices)
        .set({
          sequenceNumber: alloc.sequenceNumber,
          formattedNumber: alloc.formattedNumber,
          invoiceNumber: alloc.formattedNumber,
          printedDate,
          taxYear: allocTaxYear,
          issuedAt: new Date(),
          ...(issueFx ? fxColumns(issueFx) : {}),
          updatedAt: new Date(),
        })
        .where(eq(outboundInvoices.id, invoiceId));
      return alloc.formattedNumber;
    });
  } catch (err) {
    if (err instanceof PrintedDateOrderError) {
      return { success: false, error: err.message, dateOrder: true };
    }
    if (err instanceof OutboundCustomerDailyLimitError) {
      return {
        success: false,
        error: err.message,
        customerDailyLimit: {
          limit: err.limit,
          issuedToday: err.issuedToday,
        },
      };
    }
    throw err;
  }

  try {
    const { computation, invoiceSnapshot, businessEntity: entity } =
      await computeSignatureForDraft({ invoiceId });
    // The pre-allocation step above just stamped these onto the row, and
    // `computeSignatureForDraft` re-reads it. Narrow for TypeScript.
    if (
      invoiceSnapshot.formattedNumber == null ||
      invoiceSnapshot.sequenceNumber == null
    ) {
      throw new Error(
        `Allocation invariant violated for ${invoiceId} — fiscal number missing post-allocation.`,
      );
    }
    const snapshotFormattedNumber = invoiceSnapshot.formattedNumber;

    // Step 2: SHAAM call BEFORE archive. The submit function records
    // its own state on the invoice row (shaamStatus, allocationNumber,
    // shaamSubmittedAt, etc.) and returns the mapped outcome.
    const allocationNotRequired =
      shaamActionCode === 1 &&
      !requiresAllocation({
        issueDate: new Date(`${printedDate}T00:00:00Z`),
        preVatAmount: gateAmounts.preVatAmount,
        currency: gateAmounts.currency,
        customerIsOsekMurshe: Boolean(
          customerTaxId && /^\d{9}$/.test(customerTaxId.trim()),
        ),
        vatAmount: gateAmounts.vatAmount,
      }).required;
    let shaamResult: Awaited<ReturnType<typeof submitDocumentToShaam>>;
    // The seller already heard that the voluntary request was refused and
    // chose to issue without a number. Do not ask again, and do not
    // overwrite the Tax Authority's answer with a fresh "below threshold".
    if (options.confirmIssueWithoutAllocation && allocationNotRequired) {
      shaamResult = {
        shaamStatus: "NOT_REQUIRED",
        allocationNumber: null,
        submissionId: null,
        skipped: true,
        skippedReason: "seller_confirmed_without_allocation",
      };
    } else try {
      shaamResult = await submitDocumentToShaam({
        documentId: invoiceId,
        actorUserId: caller.userId,
        actionCode: shaamActionCode,
        voluntary:
          options.requestAllocationAnyway === true && allocationNotRequired,
      });
    } catch (shaamErr) {
      // Submit threw before recording anything (e.g. payload build error).
      // Treat as outage so the user can still issue and the cron can chase
      // it later; surface the underlying message in the admin alert.
      console.error(
        `[shaam] submitDocumentToShaam threw for ${invoiceId}:`,
        shaamErr,
      );
      shaamResult = {
        shaamStatus: "OUTAGE_ISSUED",
        allocationNumber: null,
        submissionId: null,
        skipped: false,
      };
    }

    // Step 3a: the ITA refused. By default this blocks issuance and the
    // document stays in draft so the seller can decide what to do — fix
    // the data, issue without an allocation number, offer a reverse
    // charge, contest it, or cancel. We hand back the error code and the
    // options that apply to it so the caller can render that choice
    // without a second round-trip.
    // ...but only when the document actually had to carry a number. A
    // refusal of a number nobody was owed must not block a legal invoice:
    // this branch used to key purely off `shaamStatus`, with no idea whether
    // the allocation was obligatory, so an unnecessary refusal stranded the
    // document in draft and offered the four statutory remedies for a problem
    // the seller did not have — one of which burns the fiscal number, another
    // of which stamps "your customer cannot deduct input VAT" on a document
    // where no input VAT was ever at stake.
    //
    // Re-derived rather than threaded through: `requiresAllocation` is pure,
    // and asking it again here is cheaper than carrying the answer down and
    // back. `submitDocumentToShaam` normally short-circuits these cases to
    // NOT_REQUIRED before any HTTP call, so this is defence in depth — it
    // catches a voluntary request, and any future path that asks anyway.
    const obligationAmounts = allocationAmountsIls(invoiceSnapshot);
    const allocationWasObligatory = requiresAllocation({
      issueDate: new Date(
        `${invoiceSnapshot.printedDate ?? invoiceSnapshot.invoiceDate}T00:00:00Z`,
      ),
      preVatAmount: obligationAmounts.preVatAmount,
      currency: obligationAmounts.currency,
      customerIsOsekMurshe: await customerHasTaxId(row.customerId),
      vatAmount: obligationAmounts.vatAmount,
      // Action 3 is zero VAT by definition, which reads as "not owed"; but
      // its whole purpose is the special number. A refusal of it blocks.
    }).required || shaamActionCode === 3;

    const refusedStatus: "REJECTED" | "HELD" | null =
      (shaamResult.shaamStatus === "REJECTED" ||
        shaamResult.shaamStatus === "HELD") &&
      allocationWasObligatory
        ? shaamResult.shaamStatus
        : null;
    const shaamRefused = refusedStatus !== null;

    // The seller asked for a number the document did not need, and the
    // Tax Authority did not give one. Do not issue yet: the page asks
    // whether to continue without a number. Saying no cancels the
    // unissued document and keeps the reserved number in the series.
    // Saying yes comes back as `confirmIssueWithoutAllocation` and takes
    // the normal not-required path.
    if (
      shaamResult.voluntaryDeclined &&
      !options.confirmIssueWithoutAllocation
    ) {
      const detail = await loadShaamErrorDetail(invoiceId);
      console.warn(
        `[shaam] ${invoiceId}: voluntary allocation request declined ` +
          `(${detail.errorCode ?? "no code"}) — waiting for the seller.`,
      );
      return {
        success: false,
        voluntaryAllocationDeclined: true,
        shaamErrorCode: detail.errorCode,
        error:
          detail.errorMessage ??
          "The Tax Authority did not issue an allocation number.",
      };
    }

    // Refused, but nothing was owed: issue, and say so plainly rather than
    // dressing it as an error. The ITA's own code is kept on the row and in
    // `shaam_submissions` so a genuine transport or payload fault is still
    // diagnosable afterwards.
    const refusedButNotObligatory =
      (shaamResult.shaamStatus === "REJECTED" ||
        shaamResult.shaamStatus === "HELD") &&
      !allocationWasObligatory;
    if (refusedButNotObligatory) {
      console.warn(
        `[shaam] ${invoiceId}: no allocation number (${shaamResult.shaamStatus}), but none was required — issuing. Keeping the ITA code for diagnosis.`,
      );
    }
    // The ITA refused the reverse charge itself. Issuing the locked
    // zero-VAT invoice without its special number is not one of the
    // alternatives, so nothing is issued; the seller can remove reverse
    // charge and pick another route for the original invoice.
    // The ITA refused the reverse charge itself. The replacement already
    // holds a number, so it is voided with the reason; the refused
    // original stays as it was, for the seller to resolve another way.
    if (shaamRefused && shaamActionCode === 3) {
      await abandonRefusedReplacement({
        replacementId: invoiceId,
        actorUserId: caller.userId,
      });
      return {
        success: false,
        reverseChargeBlocked: true,
        reverseChargeRefusedByIta: true,
        error: `The Tax Authority refused the reverse-charge request. Replacement invoice ${snapshotFormattedNumber} was cancelled and nothing was issued. Remove reverse charge from the original invoice to choose another option for it.`,
      };
    }
    const issuingWithoutAllocation =
      shaamRefused && options.onRejection === "issue_without_allocation";

    const refusalDetail = shaamRefused
      ? await loadShaamErrorDetail(invoiceId)
      : null;

    if (shaamRefused && !issuingWithoutAllocation) {
      const detail =
        refusalDetail ?? {
          errorCode: null,
          errorMessage: null,
          hearingDeadline: null,
          httpStatus: null,
        };
      const classification = classifyShaamRejection({
        errorCode: detail.errorCode,
        customerIsOsekMurshe: await customerHasTaxId(row.customerId),
        httpStatus: detail.httpStatus,
      });
      return {
        success: false,
        shaamRejection: refusedStatus,
        shaamErrorCode: detail.errorCode,
        shaamRejectionKind: classification.kind,
        shaamRejectionOptions: classification.options,
        shaamRejectionReasonKey: classification.reasonKey,
        shaamHearingDeadline: detail.hearingDeadline?.toISOString() ?? null,
        error:
          detail.errorMessage ??
          (shaamResult.shaamStatus === "HELD"
            ? "SHAAM held the invoice for manual review."
            : "SHAAM rejected the invoice."),
      };
    }

    // Step 3b: APPROVED + NOT_REQUIRED produce a final PDF with the
    // allocation in hand. OUTAGE_ISSUED and PENDING fall through to an
    // interim PDF and trigger the admin alert.
    //
    // A document the seller chose to issue without an allocation is also
    // `final`: unlike an outage, no number is ever coming, so there is
    // nothing for the retry cron to chase and no later re-render.
    const allocationForPdf =
      shaamResult.shaamStatus === "APPROVED"
        ? shaamResult.allocationNumber
        : null;
    const pdfKind: "interim" | "final" =
      shaamResult.shaamStatus === "APPROVED" ||
      shaamResult.shaamStatus === "NOT_REQUIRED" ||
      issuingWithoutAllocation
        ? "final"
        : "interim";

    const { config, data: invoiceData } = await buildPdfInputs(
      invoiceSnapshot,
      entity,
    );
    // Build the visible signature stamp (signed-at + key id + canonical
    // hash short + verify URL + QR) BEFORE the PDF render so the issued
    // bytes carry the footer stamp.
    // Inputs come from `computation` — the row in `document_signatures`
    // hasn't been persisted yet (that happens in the tx below), but the
    // hash + keyId + signedAt are deterministic and identical to what
    // gets written. We compute `signedAt` here ONCE so the printed
    // footer matches `document_signatures.signed_at` to the millisecond.
    const signedAt = new Date();
    const signatureStamp = await buildPdfSignatureStamp({
      documentId: invoiceSnapshot.id,
      signedAt,
      keyId: computation.keyId,
      canonicalJsonHash: computation.canonicalJsonHash,
    });
    const issuedForPdf = {
      ...invoiceData,
      allocationNumber: allocationForPdf,
      issuedWithoutAllocation: issuingWithoutAllocation,
    };
    const { buffer: pdfBuffer } = await generateInvoicePdf(
      config,
      { ...issuedForPdf, copyMarker: "original" },
      { isDraft: false, signature: signatureStamp },
    );
    let copyBuffer: Buffer | undefined;
    try {
      const copy = await generateInvoicePdf(
        config,
        { ...issuedForPdf, copyMarker: "copy" },
        { isDraft: false, signature: signatureStamp },
      );
      copyBuffer = copy.buffer;
    } catch (copyErr) {
      console.error(
        `[issue] certified copy render failed for ${invoiceId}:`,
        copyErr,
      );
    }

    const issue = await db.transaction(async (tx) => {
      await persistSignatureTx({
        tx,
        invoice: invoiceSnapshot,
        computation,
        actorUserId: caller.userId,
        signedAt,
      });

      const result = await archiveDocument({
        tx,
        document: {
          id: invoiceSnapshot.id,
          businessEntityId: invoiceSnapshot.businessEntityId,
          userId: invoiceSnapshot.userId,
          documentType: invoiceSnapshot.documentType,
          formattedNumber: snapshotFormattedNumber,
          taxYear: invoiceSnapshot.taxYear,
        },
        canonicalDocument: computation.canonicalDocument,
        canonicalJsonString: computation.canonicalJsonString,
        signature: {
          keyId: computation.keyId,
          algorithm: computation.algorithm,
          signatureBase64: computation.signatureBase64,
          signedAt,
          canonicalJsonHash: computation.canonicalJsonHash,
        },
        pdfBuffer,
        actorUserId: caller.userId,
      });

      // Stamp the kind flag onto the invoice row from inside the same
      // tx — the customer-facing `pdf_url` (operational store) is set
      // by `publishIssuedPdf` below.
      //
      // When the seller chose to issue despite a refusal, the same tx
      // records that decision: the status moves off REJECTED/HELD (the
      // refusal is resolved, not pending) while `shaamLastError*` keeps
      // the ITA's original answer readable.
      await tx
        .update(outboundInvoices)
        .set({
          pdfKind,
          sandboxDocument: entity.shaamSandbox,
          updatedAt: signedAt,
          ...(issuingWithoutAllocation
            ? {
                shaamStatus: "ISSUED_WITHOUT_ALLOCATION" as const,
                shaamRejectionChoice: "issue_without_allocation" as const,
                shaamRejectionChoiceAt: signedAt,
                shaamRejectionChoiceBy: caller.userId,
              }
            : {}),
        })
        .where(eq(outboundInvoices.id, invoiceSnapshot.id));

      const cashCeiling = assessCashCeiling({
        payments: row.payments ?? [],
        transactionTotal: Number(row.total),
        currency: row.currency ?? "ILS",
        fxRateToIls:
          fxRateNumber != null && Number.isFinite(fxRateNumber)
            ? fxRateNumber
            : null,
        customerTaxId,
      });
      if (cashCeiling?.exceeded) {
        await appendAuditEntry({
          tx,
          businessEntityId: invoiceSnapshot.businessEntityId,
          userId: invoiceSnapshot.userId,
          documentId: invoiceSnapshot.id,
          documentType: invoiceSnapshot.documentType,
          eventType: "CASH_CEILING_EXCEEDED",
          eventPayload: {
            counterparty: cashCeiling.counterparty,
            ceilingIls: cashCeiling.ceilingIls,
            permittedIls: cashCeiling.permittedIls,
            cashIls: cashCeiling.cashIls,
            transactionIls: cashCeiling.transactionIls,
            currency: row.currency ?? "ILS",
            customerTaxId,
          },
          actor: { userId: caller.userId },
        });
      }

      if (issuingWithoutAllocation) {
        await appendAuditEntry({
          tx,
          businessEntityId: invoiceSnapshot.businessEntityId,
          userId: invoiceSnapshot.userId,
          documentId: invoiceSnapshot.id,
          documentType: invoiceSnapshot.documentType,
          eventType: "SHAAM_REJECTION_RESOLVED",
          eventPayload: {
            // Two entries share this event type for one decision: this
            // one, and `notifyShaamDecision`'s record of reporting it to
            // the ITA. `phase` is what tells them apart in the audit view.
            phase: "choice_recorded",
            choice: "issue_without_allocation",
            refusedStatus,
            errorCode: refusalDetail?.errorCode ?? null,
            errorMessage: refusalDetail?.errorMessage ?? null,
            buyerCannotDeductVat: true,
          },
          actor: { userId: caller.userId },
        });
      }

      return result;
    });

    // Spec §4 — alternative 2 ("continued generation of the invoice
    // without an allocation number") must be reported to the ITA. Fire
    // and forget: the document is already issued and archived, and a
    // failed notification must not undo that.
    if (issuingWithoutAllocation) {
      void notifyShaamDecision({
        documentId: invoiceId,
        choice: "issue_without_allocation",
        actorUserId: caller.userId,
      });
    }

    // Publish the issued PDF to the operational object store so
    // `GET /api/v1/outbound-invoices/{id}/pdf` works immediately. Pattern C
    // produces ONE PDF per issue (with the allocation number stamped on
    // it when SHAAM approved synchronously), so unlike the old Pattern B
    // there is no second publish after a delayed SHAAM clear here — that
    // path lives in the cron retry, which calls `regenerateAndArchiveFinalPdf`.
    try {
      await publishIssuedPdf({
        invoiceId,
        userId: invoiceSnapshot.userId,
        formattedNumber: snapshotFormattedNumber,
        pdfBuffer,
        copyBuffer,
        updatePdfUrlRow: true,
      });
    } catch (publishErr) {
      console.error(
        `[issue] publishIssuedPdf failed for ${invoiceId}:`,
        publishErr,
      );
    }

    // Fire-and-forget admin alert when SHAAM was unreachable. The cron
    // doesn't re-notify on subsequent retries, so this branch is the
    // single source of "we hit an outage" admin email.
    if (
      shaamResult.shaamStatus === "OUTAGE_ISSUED" ||
      shaamResult.shaamStatus === "PENDING"
    ) {
      void notifyAdminOfShaamOutage({
        invoiceId: invoiceSnapshot.id,
        formattedNumber: snapshotFormattedNumber,
        total: invoiceSnapshot.total,
        currency: invoiceSnapshot.currency,
        customerName:
          (invoiceData.customerName?.trim() ?? "") || null,
        errorCode: null,
        errorMessage: null,
        actionCode: 1,
      });
    }

    // Settle the parent invoice when this issuance completes a RECEIPT
    // that points at one. We compute the post-issue outstanding balance
    // (parent.netOfCreditsAmount minus the sum of every issued/sent/paid
    // receipt linked to it, including this one) and flip the parent to
    // `paid` once we hit zero (within a one-cent tolerance for FP drift).
    // Failures are logged but never bubble — the receipt is already
    // signed, archived, and visible to the seller; the parent's status
    // can be reconciled later if the side-effect fails.
    if (
      invoiceSnapshot.documentType === "RECEIPT" &&
      invoiceSnapshot.referencesDocumentId
    ) {
      try {
        await settleParentInvoiceFromReceipt({
          parentInvoiceId: invoiceSnapshot.referencesDocumentId,
          businessEntityId: caller.businessEntityId,
          actorUserId: caller.userId,
          receiptId: invoiceSnapshot.id,
          receiptFormattedNumber: snapshotFormattedNumber,
        });
      } catch (settleErr) {
        console.error(
          `[issue] settleParentInvoiceFromReceipt failed for receipt=${invoiceSnapshot.id} parent=${invoiceSnapshot.referencesDocumentId}:`,
          settleErr,
        );
      }
    }

    // What the row actually holds now. `shaamResult` predates the
    // rejection-resolution write above, so reporting it verbatim would
    // tell webhook consumers the document is still REJECTED.
    const effectiveShaamStatus = issuingWithoutAllocation
      ? "ISSUED_WITHOUT_ALLOCATION"
      : shaamResult.shaamStatus;

    try {
      await mirrorIssuedIncomeForUser(invoiceSnapshot.userId);
    } catch (mirrorErr) {
      console.error(
        `[issue] income mirror failed for ${invoiceId}:`,
        mirrorErr,
      );
    }

    void emitEvent({
      userId: caller.userId,
      eventType: "outbound_invoice.issued",
      data: {
        outbound_invoice: {
          id: invoiceSnapshot.id,
          formatted_number: allocatedFormattedNumber,
          document_type: invoiceSnapshot.documentType,
          status: "issued",
          signed_at: signedAt.toISOString(),
          signing_key_id: computation.keyId,
          archive_chain_sequence: issue.chainSequence,
          shaam_status: effectiveShaamStatus,
          allocation_number: shaamResult.allocationNumber,
          pdf_kind: pdfKind,
        },
      },
    });

    return {
      success: true,
      formattedNumber: allocatedFormattedNumber,
      signedAt,
      keyId: computation.keyId,
      archiveChainSequence: issue.chainSequence,
      shaamStatus: effectiveShaamStatus,
      allocationNumber: shaamResult.allocationNumber,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to issue invoice",
    };
  }
}

export type CancelAfterShaamRejectionResult =
  | { success: true; formattedNumber: string }
  | { success: false; error: string };

/**
 * Option 1 of the statutory set — ביטול החשבונית. The seller saw the ITA's
 * refusal and decided not to go ahead with the sale.
 *
 * The fiscal number is NOT released. It was spent the moment it left the
 * sequence (see `issuedAt` on the schema), and re-using it would break the
 * gapless-continuity rule the whole numbering design exists to satisfy. So
 * instead of hiding the row with a soft-delete — which is what
 * `deleteOutboundInvoiceOp` does for an ordinary abandoned draft, and which
 * would leave an unexplained hole in the series — we void it in place. The
 * number stays visible in the series with a recorded reason, which is what
 * makes the gap auditable in the uniform structure / PCN874.
 */
export async function cancelAfterShaamRejectionOp(
  caller: CallerContext,
  invoiceId: string,
): Promise<CancelAfterShaamRejectionResult> {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_VOID,
    route: "cancelAfterShaamRejectionOp",
  });

  try {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(outboundInvoices)
        .where(
          and(
            eq(outboundInvoices.id, invoiceId),
            eq(outboundInvoices.businessEntityId, caller.businessEntityId),
            isNull(outboundInvoices.deletedAt),
          ),
        )
        .limit(1);

      if (!row) return { success: false as const, error: "Invoice not found" };
      if (row.status !== "draft") {
        return {
          success: false as const,
          error: `Only a document still held in draft by a SHAAM refusal can be cancelled this way (current status: ${row.status}). Issue a credit note instead.`,
        };
      }
      if (row.shaamStatus !== "REJECTED" && row.shaamStatus !== "HELD") {
        return {
          success: false as const,
          error: `This document is not blocked by a SHAAM refusal (SHAAM status: ${row.shaamStatus}).`,
        };
      }
      // Route B under way: a numbered replacement has asked the ITA to
      // resolve this refusal by reverse charge. Its answer decides.
      const replacement = await findActiveReplacement(invoiceId);
      if (replacement?.formattedNumber) {
        return {
          success: false as const,
          error: `This invoice is already being replaced by ${replacement.formattedNumber} under reverse charge.`,
        };
      }
      // The check constraint `outbound_invoices_issued_has_number` requires
      // a full number on any non-draft row. A refusal always arrives after
      // allocation, so this should hold — but an un-numbered row would fail
      // the constraint at COMMIT with a much worse error message.
      if (row.formattedNumber == null || row.sequenceNumber == null) {
        return {
          success: false as const,
          error:
            "This draft never consumed a fiscal number — delete it instead of cancelling it.",
        };
      }

      const now = new Date();
      await tx
        .update(outboundInvoices)
        .set({
          status: "voided",
          shaamStatus: "CANCELLED_AFTER_REJECTION",
          shaamRejectionChoice: "cancel",
          shaamRejectionChoiceAt: now,
          shaamRejectionChoiceBy: caller.userId,
          version: sql`${outboundInvoices.version} + 1`,
          updatedAt: now,
        })
        .where(eq(outboundInvoices.id, invoiceId));

      await appendAuditEntry({
        tx,
        businessEntityId: row.businessEntityId,
        userId: row.userId,
        documentId: invoiceId,
        documentType: row.documentType,
        eventType: "SHAAM_REJECTION_RESOLVED",
        eventPayload: {
          phase: "choice_recorded",
          choice: "cancel",
          refusedStatus: row.shaamStatus,
          errorCode: row.shaamLastErrorCode,
          errorMessage: row.shaamLastErrorMessage,
          // The spent number is the point of this entry: it explains the
          // gap in the issued series to anyone auditing it later.
          burntFormattedNumber: row.formattedNumber,
          burntSequenceNumber: row.sequenceNumber,
        },
        actor: { userId: caller.userId },
      });

      return { success: true as const, formattedNumber: row.formattedNumber };
    });

    // Spec §4 — alternative 1 ("abandonment/revocation"). Reported after
    // the void commits, for the same reason as above.
    if (result.success) {
      void notifyShaamDecision({
        documentId: invoiceId,
        choice: "cancel",
        actorUserId: caller.userId,
      });
    }
    return result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to cancel invoice",
    };
  }
}

/**
 * The latest real Tax Authority answer on this document, when that answer
 * was a refusal or a hold. Skipped checks and decision-update calls are
 * not answers. Used to tell a voluntary refusal apart from "allocation
 * was not required".
 */
export async function findVoluntaryAllocationRefusal(documentId: string) {
  const [row] = await db
    .select({
      responseStatus: shaamSubmissions.responseStatus,
      errorCode: shaamSubmissions.responseErrorCode,
      errorMessage: shaamSubmissions.responseErrorMessage,
    })
    .from(shaamSubmissions)
    .where(
      and(
        eq(shaamSubmissions.documentId, documentId),
        inArray(shaamSubmissions.responseStatus, ["REJECTED", "HELD"]),
        sql`${shaamSubmissions.actionCode} > 0`,
      ),
    )
    .orderBy(desc(shaamSubmissions.submittedAt))
    .limit(1);
  if (
    !row ||
    (row.responseStatus !== "REJECTED" && row.responseStatus !== "HELD")
  ) {
    return null;
  }
  return {
    responseStatus: row.responseStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  };
}

/**
 * The seller asked for an allocation number the document did not need,
 * the Tax Authority refused, and the seller chose not to issue.
 *
 * The number is already spent. Void the unsigned document in place so
 * the series can explain the gap: no credit note, because nothing was
 * ever signed or sent. The VAT report skips `CANCELLED_AFTER_REJECTION`.
 * The decision is reported back to the Tax Authority the same way as a
 * required-allocation cancellation.
 */
export async function cancelAfterVoluntaryAllocationDeclineOp(
  caller: CallerContext,
  invoiceId: string,
): Promise<CancelAfterShaamRejectionResult> {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_VOID,
    route: "cancelAfterVoluntaryAllocationDeclineOp",
  });

  try {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(outboundInvoices)
        .where(
          and(
            eq(outboundInvoices.id, invoiceId),
            eq(outboundInvoices.businessEntityId, caller.businessEntityId),
            isNull(outboundInvoices.deletedAt),
          ),
        )
        .limit(1);

      if (!row) return { success: false as const, error: "Invoice not found" };
      if (row.status !== "draft") {
        return {
          success: false as const,
          error: `Only an unissued document can be cancelled this way (current status: ${row.status}). Issue a credit note instead.`,
        };
      }
      if (row.shaamStatus !== "NOT_REQUIRED") {
        return {
          success: false as const,
          error: `This document is not waiting on a voluntary allocation decision (SHAAM status: ${row.shaamStatus}).`,
        };
      }
      if (row.formattedNumber == null || row.sequenceNumber == null) {
        return {
          success: false as const,
          error:
            "This draft never consumed a fiscal number — delete it instead of cancelling it.",
        };
      }

      const [refusal] = await tx
        .select({
          responseStatus: shaamSubmissions.responseStatus,
        })
        .from(shaamSubmissions)
        .where(
          and(
            eq(shaamSubmissions.documentId, invoiceId),
            inArray(shaamSubmissions.responseStatus, ["REJECTED", "HELD"]),
            sql`${shaamSubmissions.actionCode} > 0`,
          ),
        )
        .orderBy(desc(shaamSubmissions.submittedAt))
        .limit(1);
      if (
        !refusal ||
        (refusal.responseStatus !== "REJECTED" &&
          refusal.responseStatus !== "HELD")
      ) {
        return {
          success: false as const,
          error:
            "The Tax Authority has no refusal on file for this document.",
        };
      }

      const now = new Date();
      await tx
        .update(outboundInvoices)
        .set({
          status: "voided",
          shaamStatus: "CANCELLED_AFTER_REJECTION",
          shaamRejectionChoice: "cancel",
          shaamRejectionChoiceAt: now,
          shaamRejectionChoiceBy: caller.userId,
          version: sql`${outboundInvoices.version} + 1`,
          updatedAt: now,
        })
        .where(eq(outboundInvoices.id, invoiceId));

      await appendAuditEntry({
        tx,
        businessEntityId: row.businessEntityId,
        userId: row.userId,
        documentId: invoiceId,
        documentType: row.documentType,
        eventType: "SHAAM_REJECTION_RESOLVED",
        eventPayload: {
          phase: "choice_recorded",
          choice: "cancel",
          reason: "voluntary_allocation_declined",
          allocationRequired: false,
          neverIssued: true,
          refusedStatus: refusal.responseStatus,
          errorCode: row.shaamLastErrorCode,
          errorMessage: row.shaamLastErrorMessage,
          burntFormattedNumber: row.formattedNumber,
          burntSequenceNumber: row.sequenceNumber,
        },
        actor: { userId: caller.userId },
      });

      return { success: true as const, formattedNumber: row.formattedNumber };
    });

    if (result.success) {
      void notifyShaamDecision({
        documentId: invoiceId,
        choice: "cancel",
        actorUserId: caller.userId,
      });
    }
    return result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to cancel invoice",
    };
  }
}

/**
 * Reverse charge is only available when the buyer is an עוסק מורשה, which
 * we approximate by "has a tax id on file" — the same signal
 * `requiresAllocation` uses to decide whether clearance applies at all.
 */
/** The columns that freeze a document's exchange rate (migration 0047). */
function fxColumns(fx: ResolvedRate) {
  return {
    fxRateToIls: String(fx.rate),
    fxRateSource: fx.source,
    fxRateFetchedAt: fx.fetchedAt,
    fxRatePublishedAt: fx.publishedAt,
  };
}

async function customerHasTaxId(customerId: string | null): Promise<boolean> {
  if (!customerId) return false;
  const [row] = await db
    .select({ taxId: customers.taxId })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return Boolean(row?.taxId?.trim());
}

/**
 * Re-fetch the SHAAM error fields after a REJECTED/HELD outcome so the
 * issue path can return a useful message to the caller. `submitDocumentToShaam`
 * persists `shaamLastErrorMessage` but doesn't return it directly.
 */
async function loadShaamErrorDetail(invoiceId: string): Promise<{
  errorCode: string | null;
  errorMessage: string | null;
  hearingDeadline: Date | null;
  httpStatus: number | null;
}> {
  const [row] = await db
    .select({
      errorCode: outboundInvoices.shaamLastErrorCode,
      errorMessage: outboundInvoices.shaamLastErrorMessage,
      hearingDeadline: outboundInvoices.shaamHearingDeadline,
    })
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, invoiceId))
    .limit(1);

  // The invoice row keeps the error code and message but not the status
  // that carried them, and for 400/406/422 the status is the more
  // truthful signal. It lives on the submission log, one row per attempt.
  const [submission] = await db
    .select({ httpStatus: shaamSubmissions.responseHttpStatus })
    .from(shaamSubmissions)
    .where(eq(shaamSubmissions.documentId, invoiceId))
    .orderBy(desc(shaamSubmissions.submittedAt))
    .limit(1);

  return {
    errorCode: row?.errorCode ?? null,
    errorMessage: row?.errorMessage ?? null,
    hearingDeadline: row?.hearingDeadline ?? null,
    httpStatus: submission?.httpStatus ?? null,
  };
}

async function buildPdfInputs(
  invoice: typeof outboundInvoices.$inferSelect,
  entity: Awaited<
    ReturnType<typeof computeSignatureForDraft>
  >["businessEntity"],
): Promise<{ config: TemplateConfig; data: InvoiceData }> {
  const [template] = invoice.templateId
    ? await db
        .select()
        .from(invoiceTemplates)
        .where(eq(invoiceTemplates.id, invoice.templateId))
        .limit(1)
    : await db
        .select()
        .from(invoiceTemplates)
        .where(
          and(
            eq(invoiceTemplates.userId, entity.ownerUserId),
            eq(invoiceTemplates.isDefault, true),
          ),
        )
        .limit(1);

  const [customer] = invoice.customerId
    ? await db
        .select()
        .from(customers)
        .where(eq(customers.id, invoice.customerId))
        .limit(1)
    : [];

  const issuer = buildIssuerIdentityFromEntity({
    legalName: entity.legalName,
    osekMurshe: entity.osekMurshe,
    address: entity.address,
  });

  // PDF rendering runs through Puppeteer with no session cookie, so
  // the same-origin logo proxy can't authenticate the request — inline
  // the bytes as a data: URL.
  const resolvedLogoUrl = await resolveTemplateLogo(template?.logoUrl ?? null, {
    embedAsDataUrl: true,
  });

  const config: TemplateConfig = buildTemplateConfig({
    template,
    issuer,
    logoUrl: resolvedLogoUrl,
  });

  const data: InvoiceData = {
    // `buildPdfInputs` is only called from issuance / finalization paths
    // where allocation has already happened. Fall back to the draft
    // handle for safety so a misuse never produces an `undefined`
    // string in the rendered PDF.
    invoiceNumber: invoice.formattedNumber ?? `DRAFT-${invoice.id.slice(0, 8)}`,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate ?? undefined,
    customerName: customer?.name ?? "—",
    customerEmail: printedCustomerEmail(invoice.customerEmail, customer?.email),
    customerAddress: customer?.address ?? undefined,
    customerTaxId: customer?.taxId ?? undefined,
    items: invoice.items,
    subtotal: Number(invoice.subtotal),
    vatRate: Number(invoice.vatRate ?? 18),
    vatAmount: Number(invoice.vatAmount ?? 0),
    total: Number(invoice.total),
    currency: invoice.currency ?? "ILS",
    language: invoice.language ?? "he",
    notes: invoice.notes ?? undefined,
    documentType: invoice.documentType,
    allocationNumber: invoice.allocationNumber ?? null,
    issuedWithoutAllocation:
      invoice.shaamStatus === "ISSUED_WITHOUT_ALLOCATION",
    sandbox: entity.shaamSandbox,
    payments: (invoice.payments ?? []) as PaymentEntry[],
    reverseCharge: invoice.reverseCharge,
    fxRateToIls: invoice.fxRateToIls,
    copyMarker: "original",
  };
  return { config, data: withForeignExchangeDisplay(data) };
}

function shaamGateMessage(state: ShaamGateState): string {
  switch (state) {
    case "PENDING":
      return "SHAAM allocation is still pending for this invoice. Wait for the allocation to clear, or send anyway with `force: true` (the customer-facing PDF will not include the allocation number).";
    case "OUTAGE_ISSUED":
      return "This invoice was issued during a SHAAM outage; the allocation number has not been received yet. Wait for the retry cron to clear it, or send anyway with `force: true`.";
    case "REJECTED":
      return "SHAAM rejected this invoice. Fix the underlying issue (e.g. the customer's tax id) and re-issue, or send anyway with `force: true` knowing the PDF will not include an allocation number.";
    case "HELD":
      return "SHAAM placed this invoice on hold. Resolve the hold via the SHAAM portal, or send anyway with `force: true` knowing the PDF will not include an allocation number.";
    case "UNRESOLVED":
      return "Automatic retries for this invoice are exhausted and it still has no allocation number. Nothing was refused — retry the submission, or send anyway with `force: true` knowing the PDF will not include an allocation number.";
  }
}

/**
 * Capture the seller's send intent on an invoice that is currently
 * blocked by the SHAAM gate. The cron picks the queued params up the
 * moment SHAAM clears and fires the send (`force: true`), then clears
 * the queue. Re-queuing overwrites a prior queue.
 */
export async function queueOutboundInvoiceForDeliveryOp(
  caller: CallerContext,
  input: QueueOutboundInvoiceForDeliveryInput,
): Promise<QueueOutboundInvoiceForDeliveryResult> {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_CREATE_DRAFT,
    route: "queueOutboundInvoiceForDeliveryOp",
  });

  const to = input.to.trim();
  const subject = input.subject.trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { success: false, error: "Invalid recipient email address." };
  }
  if (!subject) {
    return { success: false, error: "Subject is required." };
  }

  const [row] = await db
    .select()
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.id, input.invoiceId),
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return { success: false, error: "Invoice not found." };
  if (row.status === "draft") {
    return {
      success: false,
      error: "Issue the invoice before queueing a delivery.",
    };
  }
  if (row.status === "voided") {
    return {
      success: false,
      error: "Voided invoices cannot be queued for delivery.",
    };
  }
  if (!SHAAM_GATE_BLOCKING_STATES.has(row.shaamStatus as ShaamGateState)) {
    return {
      success: false,
      error:
        "SHAAM is not blocking this invoice — send it directly instead of queueing.",
    };
  }

  const queuedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(outboundInvoices)
      .set({
        queuedDeliveryRecipient: to,
        queuedDeliverySubject: subject,
        queuedDeliveryBodyText: input.body ?? "",
        queuedDeliveryAttachCertificate: Boolean(
          input.attachWithholdingCertificate,
        ),
        queuedDeliveryQueuedAt: queuedAt,
        queuedDeliveryQueuedBy: caller.userId,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: queuedAt,
      })
      .where(
        and(
          eq(outboundInvoices.id, input.invoiceId),
          eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        ),
      );
    await appendAuditEntry({
      tx,
      businessEntityId: caller.businessEntityId,
      userId: caller.userId,
      documentId: input.invoiceId,
      documentType: row.documentType,
      eventType: "STATUS_CHANGED",
      eventPayload: {
        method: "queue_for_shaam_clear",
        recipient: to,
        subject,
        shaamStatusAtQueue: row.shaamStatus,
      },
      actor: { userId: caller.userId },
    });
  });

  return {
    success: true,
    queued: true,
    queuedAt: queuedAt.toISOString(),
  };
}

/**
 * Cancel a previously queued auto-send. Returns `cleared: false` if no
 * queue was set (no-op, idempotent).
 */
export async function cancelQueuedOutboundInvoiceDeliveryOp(
  caller: CallerContext,
  invoiceId: string,
): Promise<CancelQueuedDeliveryResult> {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_CREATE_DRAFT,
    route: "cancelQueuedOutboundInvoiceDeliveryOp",
  });

  const [before] = await db
    .select({
      id: outboundInvoices.id,
      documentType: outboundInvoices.documentType,
      queuedRecipient: outboundInvoices.queuedDeliveryRecipient,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.id, invoiceId),
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .limit(1);
  if (!before) return { success: false, error: "Invoice not found." };
  if (!before.queuedRecipient) return { success: true, cleared: false };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(outboundInvoices)
      .set({
        queuedDeliveryRecipient: null,
        queuedDeliverySubject: null,
        queuedDeliveryBodyText: null,
        queuedDeliveryAttachCertificate: false,
        queuedDeliveryQueuedAt: null,
        queuedDeliveryQueuedBy: null,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(outboundInvoices.id, invoiceId),
          eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        ),
      );
    await appendAuditEntry({
      tx,
      businessEntityId: caller.businessEntityId,
      userId: caller.userId,
      documentId: invoiceId,
      documentType: before.documentType,
      eventType: "STATUS_CHANGED",
      eventPayload: {
        method: "cancel_queued_delivery",
        cancelledRecipient: before.queuedRecipient,
      },
      actor: { userId: caller.userId },
    });
  });

  return { success: true, cleared: true };
}
