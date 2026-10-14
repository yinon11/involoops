/**
 * Document type catalogue for ITA-compliant outbound documents.
 *
 * The TypeScript list here is the single source of truth; the Drizzle
 * `document_type` pgEnum in `src/db/schema/document-number-sequences.ts`
 * mirrors it, and the prefix map in `format-number.ts` consumes it.
 *
 * Any addition must be reflected in all three places and in the i18n
 * dictionaries (`documents.type.*`).
 */

export const DOCUMENT_TYPES = [
  "TAX_INVOICE",
  "TAX_INVOICE_RECEIPT",
  "RECEIPT",
  "CREDIT_INVOICE",
  "PROFORMA",
  "DELIVERY_NOTE",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Short code that appears in `formattedNumber`, e.g. `TI` in `2026-TI-000001`. */
export const DOCUMENT_TYPE_PREFIX: Record<DocumentType, string> = {
  TAX_INVOICE: "TI",
  TAX_INVOICE_RECEIPT: "TIR",
  RECEIPT: "RC",
  CREDIT_INVOICE: "CI",
  PROFORMA: "PF",
  DELIVERY_NOTE: "DN",
};

export function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === "string" &&
    (DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}
