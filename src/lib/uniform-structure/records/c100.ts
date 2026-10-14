/**
 * C100 — document header (v1.31 §4.3). One per outbound document
 * in the period. Followed by at least one D110 (line items) and
 * optionally D120 (payments) records.
 *
 * Per spec §2.4(יב): values are positive (+) by default; only
 * fields whose meaning REDUCES the document amount (document
 * discount field 1220) carry (-). Document-type sign convention
 * (e.g. credit invoice) is communicated via `documentType` (field
 * 1203), not via amount sign — so amounts on a credit invoice
 * remain positive.
 */

import type { FieldSpec } from "../types";
import { serializeRecord } from "./serializer";

export interface C100Record {
  recordCode: "C100";
  /** 1201 — running line number in BKMVDATA. */
  recordSequence: string;
  /** 1202 — business VAT number. */
  vatNumber: string;
  /** 1203 — document type code (Annex 1; see {@link documentTypeToCode}). */
  documentType: string;
  /** 1204 — document number (alphanumeric, max 20). */
  documentNumber: string;
  /** 1205 — document issue date YYYYMMDD. */
  documentIssueDate: string;
  /** 1206 — document issue time HHMM. */
  documentIssueTime?: string;
  /** 1207 — customer/supplier name (50 chars, mandatory for invoices). */
  customerName?: string;
  /** 1208 — address: street (50 chars). */
  customerStreet?: string;
  /** 1209 — address: house number (10 chars). */
  customerHouseNumber?: string;
  /** 1210 — address: city (30 chars). */
  customerCity?: string;
  /** 1211 — address: zip (8 chars). */
  customerZip?: string;
  /** 1212 — address: country (30 chars). */
  customerCountry?: string;
  /** 1213 — address: country code per ISO 3166-1 alpha-2 (2 chars). */
  customerCountryCode?: string;
  /** 1214 — phone (15 chars). */
  customerPhone?: string;
  /** 1215 — customer/supplier VAT number (9 digits). */
  customerVatNumber?: string;
  /** 1216 — value date YYYYMMDD. */
  valueDate: string;
  /** 1217 — total in foreign currency (signed, X9(12)v99). Export-only. */
  foreignTotalAmount?: string;
  /** 1218 — foreign currency code (3 chars). Export-only. */
  foreignCurrency?: string;
  /** 1219 — amount before document discount (signed, X9(12)v99). */
  amountBeforeDiscount: string;
  /** 1220 — document discount (signed, X9(12)v99). Negative if discount applied. */
  documentDiscount?: string;
  /** 1221 — amount after discount, excluding VAT (signed). */
  amountAfterDiscountExVat: string;
  /** 1222 — VAT amount (signed). */
  vatAmount?: string;
  /** 1223 — amount including VAT (signed). For receipts: excludes withholding. */
  amountIncludingVat?: string;
  /** 1224 — withholding amount (signed, X9(9)v99 → 12 wide). Receipts only. */
  withholdingAmount?: string;
  /** 1225 — customer key (15 chars). Mandatory for invoices. */
  customerKey?: string;
  /** 1226 — matching field (10 chars). */
  matchingField?: string;
  /** 1228 — document cancelled flag (1 char). "1" if cancelled. */
  documentCancelled?: string;
  /** 1230 — document date YYYYMMDD (the date printed on the document). */
  documentDate: string;
  /** 1231 — branch ID (7 chars). Mandatory when A000 field 1034 = 1. */
  branchId?: string;
  /** 1233 — user who performed the action (9 chars). */
  userActionPerformer?: string;
  /** 1234 — internal linking field to D110 lines (numeric, 7 digits). */
  linkingFieldToLine?: string;
  /** 1235 — reserved (13 chars). */
  reservedFutureUse?: string;
}

export const C100_FIELDS: readonly FieldSpec[] = [
  { name: "recordCode", fieldNumber: 1200, start: 1, length: 4, type: "text", mandatory: true, value: "C100" },
  { name: "recordSequence", fieldNumber: 1201, start: 5, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "vatNumber", fieldNumber: 1202, start: 14, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "documentType", fieldNumber: 1203, start: 23, length: 3, type: "numeric", mandatory: true, pad: "0" },
  { name: "documentNumber", fieldNumber: 1204, start: 26, length: 20, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "documentIssueDate", fieldNumber: 1205, start: 46, length: 8, type: "date", mandatory: true },
  { name: "documentIssueTime", fieldNumber: 1206, start: 54, length: 4, type: "numeric", mandatory: false, pad: "0" },
  { name: "customerName", fieldNumber: 1207, start: 58, length: 50, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerStreet", fieldNumber: 1208, start: 108, length: 50, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerHouseNumber", fieldNumber: 1209, start: 158, length: 10, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerCity", fieldNumber: 1210, start: 168, length: 30, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerZip", fieldNumber: 1211, start: 198, length: 8, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerCountry", fieldNumber: 1212, start: 206, length: 30, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerCountryCode", fieldNumber: 1213, start: 236, length: 2, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerPhone", fieldNumber: 1214, start: 238, length: 15, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerVatNumber", fieldNumber: 1215, start: 253, length: 9, type: "numeric", mandatory: false, pad: "0" },
  { name: "valueDate", fieldNumber: 1216, start: 262, length: 8, type: "date", mandatory: true },
  { name: "foreignTotalAmount", fieldNumber: 1217, start: 270, length: 15, type: "signedNumeric", mandatory: false, decimals: 2 },
  { name: "foreignCurrency", fieldNumber: 1218, start: 285, length: 3, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "amountBeforeDiscount", fieldNumber: 1219, start: 288, length: 15, type: "signedNumeric", mandatory: true, decimals: 2 },
  { name: "documentDiscount", fieldNumber: 1220, start: 303, length: 15, type: "signedNumeric", mandatory: false, decimals: 2 },
  { name: "amountAfterDiscountExVat", fieldNumber: 1221, start: 318, length: 15, type: "signedNumeric", mandatory: true, decimals: 2 },
  { name: "vatAmount", fieldNumber: 1222, start: 333, length: 15, type: "signedNumeric", mandatory: false, decimals: 2 },
  { name: "amountIncludingVat", fieldNumber: 1223, start: 348, length: 15, type: "signedNumeric", mandatory: false, decimals: 2 },
  { name: "withholdingAmount", fieldNumber: 1224, start: 363, length: 12, type: "signedNumeric", mandatory: false, decimals: 2 },
  { name: "customerKey", fieldNumber: 1225, start: 375, length: 15, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "matchingField", fieldNumber: 1226, start: 390, length: 10, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "documentCancelled", fieldNumber: 1228, start: 400, length: 1, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "documentDate", fieldNumber: 1230, start: 401, length: 8, type: "date", mandatory: true },
  { name: "branchId", fieldNumber: 1231, start: 409, length: 7, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "userActionPerformer", fieldNumber: 1233, start: 416, length: 9, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "linkingFieldToLine", fieldNumber: 1234, start: 425, length: 7, type: "numeric", mandatory: false, pad: "0" },
  { name: "reservedFutureUse", fieldNumber: 1235, start: 432, length: 13, type: "text", mandatory: false, justify: "left", pad: " " },
];

export const C100_TOTAL_LENGTH = 444;

export function serializeC100(record: C100Record): string {
  return serializeRecord(C100_FIELDS, record, C100_TOTAL_LENGTH);
}

/**
 * Map our internal `DocumentType` strings to the v1.31 numeric
 * document-type code (Annex 1, §5.1 of the Uniform Structure spec).
 *
 * IMPORTANT — this is the *Uniform Structure* mapping, not the
 * SHAAM REST API mapping. SHAAM API v2.0 uses 332 for proforma;
 * v1.31 has no 332 entry and the closest match is 300
 * (חשבונית/חשבונית עסקה). The two paths must stay separate; the
 * SHAAM mapping lives in `src/lib/shaam/payload.ts`.
 *
 * Codes confirmed against v1.31 §5.1:
 *   100 = הזמנה              (order)
 *   200 = תעודת משלוח         (delivery note)
 *   300 = חשבונית/חשבונית עסקה (transaction invoice / proforma)
 *   305 = חשבונית-מס          (tax invoice)
 *   320 = חשבונית מס/קבלה     (tax invoice receipt)
 *   330 = חשבונית מס זיכוי    (credit invoice)
 *   400 = קבלה               (receipt)
 *   710 = זיכוי רכש          (purchase credit — NOT a delivery note)
 */
export function documentTypeToCode(type: string): string {
  switch (type) {
    case "TAX_INVOICE":
      return "305";
    case "TAX_INVOICE_RECEIPT":
      return "320";
    case "RECEIPT":
      return "400";
    case "CREDIT_INVOICE":
      return "330";
    case "PROFORMA":
      // v1.31 has no proforma-specific code; "transaction invoice"
      // (חשבונית עסקה / 300) is the spec's catch-all for
      // pre-tax-invoice issuances. SHAAM API uses 332 — kept
      // separately in shaam/payload.ts.
      return "300";
    case "DELIVERY_NOTE":
      return "200";
    default:
      return "305";
  }
}
