import type { DocumentType } from "@/lib/documents/types";

/**
 * Issued tax documents are reversed by a credit invoice. A receipt, a
 * proforma, and a delivery note carry no VAT, so they are cancelled in
 * place instead.
 */
export const DOCUMENT_TYPES_REQUIRING_CREDIT_NOTE: ReadonlySet<string> =
  new Set<DocumentType>([
    "TAX_INVOICE",
    "TAX_INVOICE_RECEIPT",
    "CREDIT_INVOICE",
  ]);

/** True when an issued document may be cancelled without a credit invoice. */
export function canCancelWithoutCreditNote(documentType: string): boolean {
  return !DOCUMENT_TYPES_REQUIRING_CREDIT_NOTE.has(documentType);
}
