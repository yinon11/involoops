/**
 * MOVEIN export builder — maps outbound invoices to Hashavshevet journal lines.
 *
 * Not wired to UI yet. Card mapping + customer external numbers must be
 * configured before calling.
 */

import {
  toStatutoryIlsAmount,
  toStatutoryIlsAmounts,
} from "@/lib/outbound/statutory-ils-amounts";
import { withholdingAmountOf } from "@/lib/documents/payments";
import type { OutboundPaymentEntry } from "@/db/schema/outbound-invoices";
import type { MoveinCardMapping, MoveinExportConfig, MoveinMethod } from "./types";
import { serializeDetailedMovein, type MoveinJournalLine } from "./serialize";

export interface MoveinSourceInvoice {
  formattedNumber: string;
  invoiceDate: Date;
  customerExternalAccount?: string | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  currency: string;
  /** Rate frozen at issue (ILS per 1 unit); null for ILS / older documents. */
  fxRateToIls?: string | number | null;
  documentType: string;
  /** Receipt payment entries — the ניכוי מס במקור split is derived from these. */
  payments?: OutboundPaymentEntry[] | null;
}

export interface BuildMoveinResult {
  method: MoveinMethod;
  data: Buffer;
  movementCount: number;
}

function isReceiptLike(documentType: string): boolean {
  return documentType === "RECEIPT" || documentType === "TAX_INVOICE_RECEIPT";
}

function isCreditNote(documentType: string): boolean {
  return documentType === "CREDIT_INVOICE";
}

/** MOVEIN amount fields are unsigned — debit/credit side conveys direction. */
function exportAmount(value: number): number {
  const n = Math.abs(Number(value));
  return Number.isFinite(n) ? n : 0;
}

/** Detailed-layout description field width (positions 29–50). */
const DETAILS_MAX = 22;

/**
 * Compose the description so the document number — the only per-document
 * identifier in this column — is never the part that gets truncated. The
 * full `${label} ${number}` is used when it fits; otherwise we fall back to
 * the bare number (and only clip the number itself in the unlikely event it
 * alone exceeds the field). Without this, sequential numbers like
 * `2026-TIR-000003/5/6` collapse to an identical truncated string because the
 * distinguishing final digit falls past column 50.
 */
function documentDetails(label: string, number: string): string {
  const full = `${label} ${number}`;
  if (full.length <= DETAILS_MAX) return full;
  return number.length <= DETAILS_MAX ? number : number.slice(-DETAILS_MAX);
}

/**
 * Build journal lines for a single tax invoice (simplified v1 — one compound
 * entry per document). Receipt / credit-note paths are stubbed for extension.
 */
export function invoiceToJournalLines(
  invoice: MoveinSourceInvoice,
  cards: MoveinCardMapping,
): MoveinJournalLine[] {
  const customerAccount =
    invoice.customerExternalAccount?.trim() || cards.cashCustomer;
  const ref = invoice.formattedNumber.replace(/\D/g, "").slice(-5) || "0";
  const date = invoice.invoiceDate;
  const ils = toStatutoryIlsAmounts(invoice);

  if (isCreditNote(invoice.documentType)) {
    return [
      {
        movementType: "CN",
        reference1: ref,
        referenceDate: date,
        details: documentDetails("Credit", invoice.formattedNumber),
        debitAccount1: cards.income,
        ilsDebit1: exportAmount(ils.subtotal),
        debitAccount2: cards.outputVat,
        ilsDebit2: exportAmount(ils.vatAmount),
        creditAccount1: customerAccount,
        ilsCredit1: exportAmount(ils.total),
      },
    ];
  }

  if (isReceiptLike(invoice.documentType)) {
    // The receipt closes the customer for its gross total, but only
    // part of it reached the bank: whatever the customer withheld as
    // ניכוי מס במקור was remitted to the ITA on our behalf and belongs
    // in the withholding card, where it can be claimed against the
    // annual assessment. Booking the gross to `generalCash` overstates
    // the bank and loses the credit entirely.
    const total = exportAmount(ils.total);
    const withholding = Math.min(
      exportAmount(
        toStatutoryIlsAmount(
          withholdingAmountOf(invoice.payments),
          invoice.currency,
          invoice.fxRateToIls,
        ),
      ),
      total,
    );
    const received = Number((total - withholding).toFixed(2));
    const base = {
      movementType: "RC" as const,
      reference1: ref,
      referenceDate: date,
      details: documentDetails("Receipt", invoice.formattedNumber),
      creditAccount1: customerAccount,
      ilsCredit1: total,
    };

    if (withholding <= 0) {
      return [{ ...base, debitAccount1: cards.generalCash, ilsDebit1: total }];
    }
    // Fully withheld (nothing hit the bank) — a single debit, so the
    // entry never carries a zero-amount cash leg.
    if (received <= 0) {
      return [
        { ...base, debitAccount1: cards.withholdingTax, ilsDebit1: withholding },
      ];
    }
    return [
      {
        ...base,
        debitAccount1: cards.generalCash,
        ilsDebit1: received,
        debitAccount2: cards.withholdingTax,
        ilsDebit2: withholding,
      },
    ];
  }

  // Default: tax invoice — customer debit, income + VAT credit.
  return [
    {
      movementType: "IV",
      reference1: ref,
      referenceDate: date,
      details: documentDetails("Invoice", invoice.formattedNumber),
      debitAccount1: customerAccount,
      ilsDebit1: exportAmount(ils.total),
      creditAccount1: cards.income,
      ilsCredit1: exportAmount(ils.subtotal),
      creditAccount2: cards.outputVat,
      ilsCredit2: exportAmount(ils.vatAmount),
    },
  ];
}

export function buildMoveinExport(params: {
  config: MoveinExportConfig;
  invoices: MoveinSourceInvoice[];
}): BuildMoveinResult {
  const lines: MoveinJournalLine[] = [];
  for (const inv of params.invoices) {
    lines.push(...invoiceToJournalLines(inv, params.config.cardMapping));
  }

  if (params.config.method === "detailed") {
    return {
      method: "detailed",
      data: serializeDetailedMovein(lines),
      movementCount: lines.length,
    };
  }

  throw new Error(
    `MOVEIN method "${params.config.method}" is not implemented — only "detailed" is supported`,
  );
}
