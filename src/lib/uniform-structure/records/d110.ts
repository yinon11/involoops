/**
 * D110 — document line item (v1.31 §4.4). One per line on every
 * C100 document. Total length 339 chars.
 *
 * Per spec §2.4(יב): values are positive (+) by default; only
 * fields that REDUCE the document — line discount field 1266 —
 * carry (-).
 */

import type { FieldSpec } from "../types";
import { serializeRecord } from "./serializer";

export interface D110Record {
  recordCode: "D110";
  /** 1251 — running line number in BKMVDATA. */
  recordSequence: string;
  /** 1252 — business VAT number. */
  vatNumber: string;
  /** 1253 — document type (matches the parent C100). */
  documentType: string;
  /** 1254 — document number (matches the parent C100). */
  documentNumber: string;
  /** 1255 — line number within the document (1-based). */
  lineNumber: string;
  /** 1256 — base document type (when line is derived from another doc). */
  baseDocumentType?: string;
  /** 1257 — base document number. */
  baseDocumentNumber?: string;
  /** 1258 — transaction type: 1=service, 2=goods, 3=service+goods. */
  transactionType?: string;
  /** 1259 — internal SKU (20 chars). */
  internalSku?: string;
  /** 1260 — item description (30 chars, mandatory). */
  itemDescription: string;
  /** 1261 — manufacturer name (50 chars; for goods listed in §36 Annex C). */
  manufacturerName?: string;
  /** 1262 — manufacturer-stamped serial number (30 chars). */
  productSerialNumber?: string;
  /** 1263 — unit-of-measure description (20 chars). */
  unitOfMeasureDescription?: string;
  /** 1264 — quantity (signed, X9(12)v9999 → 17 wide). */
  quantity: string;
  /** 1265 — unit price excl. VAT (signed, X9(12)v99). */
  unitPriceExVat?: string;
  /** 1266 — line discount (signed, X9(12)v99). Negative if discount. */
  lineDiscount?: string;
  /** 1267 — line total = qty * unit_price - line_discount (signed). */
  lineTotal?: string;
  /** 1268 — VAT rate as 9(2)v99 (e.g. 1700 for 17.00%). */
  vatRate: string;
  /** 1270 — branch ID (mandatory when A000 field 1034 = 1). */
  branchId?: string;
  /** 1272 — document date YYYYMMDD. */
  documentDate: string;
  /** 1273 — internal linking field to C100 header (numeric, 7 digits). */
  linkingFieldToHeader?: string;
  /** 1274 — branch ID for the base document. */
  baseDocumentBranchId?: string;
  /** 1275 — reserved (21 chars). */
  reservedFutureUse?: string;
}

export const D110_FIELDS: readonly FieldSpec[] = [
  { name: "recordCode", fieldNumber: 1250, start: 1, length: 4, type: "text", mandatory: true, value: "D110" },
  { name: "recordSequence", fieldNumber: 1251, start: 5, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "vatNumber", fieldNumber: 1252, start: 14, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "documentType", fieldNumber: 1253, start: 23, length: 3, type: "numeric", mandatory: true, pad: "0" },
  { name: "documentNumber", fieldNumber: 1254, start: 26, length: 20, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "lineNumber", fieldNumber: 1255, start: 46, length: 4, type: "numeric", mandatory: true, pad: "0" },
  { name: "baseDocumentType", fieldNumber: 1256, start: 50, length: 3, type: "numeric", mandatory: false, pad: "0" },
  { name: "baseDocumentNumber", fieldNumber: 1257, start: 53, length: 20, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "transactionType", fieldNumber: 1258, start: 73, length: 1, type: "numeric", mandatory: false, pad: "0" },
  { name: "internalSku", fieldNumber: 1259, start: 74, length: 20, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "itemDescription", fieldNumber: 1260, start: 94, length: 30, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "manufacturerName", fieldNumber: 1261, start: 124, length: 50, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "productSerialNumber", fieldNumber: 1262, start: 174, length: 30, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "unitOfMeasureDescription", fieldNumber: 1263, start: 204, length: 20, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "quantity", fieldNumber: 1264, start: 224, length: 17, type: "signedNumeric", mandatory: true, decimals: 4 },
  { name: "unitPriceExVat", fieldNumber: 1265, start: 241, length: 15, type: "signedNumeric", mandatory: false, decimals: 2 },
  { name: "lineDiscount", fieldNumber: 1266, start: 256, length: 15, type: "signedNumeric", mandatory: false, decimals: 2 },
  { name: "lineTotal", fieldNumber: 1267, start: 271, length: 15, type: "signedNumeric", mandatory: false, decimals: 2 },
  { name: "vatRate", fieldNumber: 1268, start: 286, length: 4, type: "amount", mandatory: true, decimals: 2 },
  { name: "branchId", fieldNumber: 1270, start: 290, length: 7, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "documentDate", fieldNumber: 1272, start: 297, length: 8, type: "date", mandatory: true },
  { name: "linkingFieldToHeader", fieldNumber: 1273, start: 305, length: 7, type: "numeric", mandatory: false, pad: "0" },
  { name: "baseDocumentBranchId", fieldNumber: 1274, start: 312, length: 7, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "reservedFutureUse", fieldNumber: 1275, start: 319, length: 21, type: "text", mandatory: false, justify: "left", pad: " " },
];

export const D110_TOTAL_LENGTH = 339;

export function serializeD110(record: D110Record): string {
  return serializeRecord(D110_FIELDS, record, D110_TOTAL_LENGTH);
}
