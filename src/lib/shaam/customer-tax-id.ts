import { isValidIsraeliVatNumber } from "@/lib/uniform-structure/vat-checksum";
import { requiresAllocation } from "@/lib/shaam/thresholds";

/**
 * A customer number an allocation request can actually be made with: nine
 * digits, and a check digit that holds. Anything else the ITA refuses, so
 * accepting it here only moves the failure to after a fiscal number has
 * been spent.
 */
export function isAllocatableCustomerTaxId(
  taxId: string | null | undefined,
): boolean {
  const t = taxId?.trim() ?? "";
  return /^\d{9}$/.test(t) && isValidIsraeliVatNumber(t);
}

/** The document types the issue path sends to the ITA with VAT on them. */
const ALLOCATION_DOCUMENT_TYPES = new Set(["TAX_INVOICE", "TAX_INVOICE_RECEIPT"]);

/**
 * True when this document would need an allocation number if the customer
 * had a licensed-dealer number — and the customer doesn't have a usable one.
 *
 * `requiresAllocation` treats a missing customer number as "no obligation"
 * (`no_customer_tax_id`) because, read literally, the obligation covers
 * licensed dealers only. That let an invoice go out with no number and a
 * notice after the fact. A missing number is a blank field, not proof the
 * buyer is a private person, so above the threshold the seller has to fill
 * it in before the document is issued — while nothing has been spent yet.
 *
 * Asked with `customerIsOsekMurshe: true` on purpose: that isolates the
 * other conditions (amount, currency, date, non-zero VAT), so a document
 * those already excuse — a zero-VAT invoice, a foreign-currency one, one
 * under the threshold — is never blocked for a customer number it would
 * not have used.
 */
export function customerTaxIdBlocksIssue(params: {
  documentType: string;
  issueDate: Date;
  preVatAmount: string;
  vatAmount: string | null;
  currency: string;
  customerTaxId: string | null | undefined;
}): boolean {
  if (!ALLOCATION_DOCUMENT_TYPES.has(params.documentType)) return false;
  if (isAllocatableCustomerTaxId(params.customerTaxId)) return false;
  return requiresAllocation({
    issueDate: params.issueDate,
    preVatAmount: params.preVatAmount,
    currency: params.currency,
    customerIsOsekMurshe: true,
    vatAmount: params.vatAmount,
  }).required;
}
