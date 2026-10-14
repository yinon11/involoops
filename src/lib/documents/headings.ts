import type { DocumentType } from "@/lib/documents/types";

/**
 * ITA rule (חוק מע"מ + תקנות מע"מ ניהול פנקסי חשבונות, תשל"ג-1973
 * §9a, §23): every tax document must display the document-type
 * literal verbatim in Hebrew. English output mirrors the Hebrew for
 * clarity, but legal compliance is driven off the Hebrew literal.
 *
 * TAX_INVOICE             → חשבונית מס
 * TAX_INVOICE_RECEIPT     → חשבונית מס / קבלה
 * RECEIPT                 → קבלה
 * CREDIT_INVOICE          → חשבונית זיכוי
 * PROFORMA                → חשבונית פרופורמה (not a tax document;
 *                           legally optional, still labelled)
 * DELIVERY_NOTE           → תעודת משלוח
 */
export const DOC_HEADING_HE: Record<DocumentType, string> = {
  TAX_INVOICE: "חשבונית מס",
  TAX_INVOICE_RECEIPT: "חשבונית מס / קבלה",
  RECEIPT: "קבלה",
  CREDIT_INVOICE: "חשבונית זיכוי",
  PROFORMA: "חשבונית פרופורמה",
  DELIVERY_NOTE: "תעודת משלוח",
};

export const DOC_HEADING_EN: Record<DocumentType, string> = {
  TAX_INVOICE: "Tax Invoice",
  TAX_INVOICE_RECEIPT: "Tax Invoice / Receipt",
  RECEIPT: "Receipt",
  CREDIT_INVOICE: "Credit Invoice",
  PROFORMA: "Proforma Invoice",
  DELIVERY_NOTE: "Delivery Note",
};

export function getDocumentHeading(
  documentType: DocumentType | undefined,
  language: string,
): string {
  const t = documentType ?? "TAX_INVOICE";
  return language === "he" ? DOC_HEADING_HE[t] : DOC_HEADING_EN[t];
}

/**
 * Bookkeeping rules: the first PDF handed out is the original (מקור).
 * Every later download or resend is a certified copy
 * (העתק נאמן למקור). The Hebrew form is the legally dispositive one.
 */
export function getCopyMarker(
  marker: "original" | "copy" | null | undefined,
  language: string,
): string | null {
  if (!marker) return null;
  if (language === "he") {
    return marker === "copy" ? "העתק נאמן למקור" : "מקור";
  }
  return marker === "copy" ? "Certified copy" : "ORIGINAL";
}

/**
 * Hebrew convention: label Osek Murshe / company tax IDs with a
 * single compact marker ("ע.מ / ח.פ.") rather than the English
 * "Tax ID". The ITA accepts either — we always include the string.
 */
export function getTaxIdLabel(language: string): string {
  return language === "he" ? "ע.מ / ח.פ." : "Tax ID";
}
