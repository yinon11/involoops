import type { DocumentType } from "./types";

/**
 * Israeli statutory VAT rate (%). The ITA raised it from 17% to 18%
 * effective 2025-01-01 and the rate has held there since. Hard-coded
 * because every Osek Murshe + חברה בע״מ + עמותה charges this exact
 * value when VAT is included; tenants who don't charge VAT (Osek
 * Patur, export-only) toggle "Include VAT" off on their invoices and
 * the line drops to 0%.
 *
 * If the Knesset moves the rate again, change the constant here and
 * the create-invoice form picks up the new value automatically. Past
 * issued documents are immutable (signature + canonical JSON include
 * the rate they were signed with) so the change only affects new
 * drafts.
 */
export const STATUTORY_VAT_RATE = 18;

/** Zero-VAT rate for invoices issued without VAT (Osek Patur, export, etc.). */
export const ZERO_VAT_RATE = 0;

export function vatRateForInclusive(inclusive: boolean): number {
  return inclusive ? STATUTORY_VAT_RATE : ZERO_VAT_RATE;
}

/**
 * True when a document type should print the VAT breakdown rows
 * (subtotal + VAT) above its total.
 *
 * A pure קבלה must not: the VAT was already charged and reported on the
 * tax invoice it settles, so the receipt is issued at 0% by construction
 * (see `create-invoice-form`). Printing "מע״מ (0%) 0.00" on it reads as a
 * claim that the underlying transaction was VAT-exempt or zero-rated,
 * which is the opposite of what happened, and the "סכום לפני מע״מ" row
 * above it just restates the total under a misleading label. A receipt
 * shows one figure: what was received.
 *
 * Deliberately keyed on the document type, not on `vatRate === 0` — a
 * genuine zero-rated export invoice (מע״מ בשיעור אפס) and an Osek Patur's
 * documents are also 0%, and there the row is meaningful: it evidences
 * the zero rating. A TAX_INVOICE_RECEIPT is a tax invoice and keeps its
 * breakdown.
 *
 * Not a template preference. `showVatBreakdown` lets a seller hide the
 * rows across their documents; this says the rows are wrong on this
 * document, whatever the template says.
 */
export function showsVatBreakdown(documentType: DocumentType | undefined): boolean {
  return documentType !== "RECEIPT";
}
