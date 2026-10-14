/**
 * D120 — receipt/payment line (v1.31 §4.5). Emitted for documents
 * that record an incoming payment (TAX_INVOICE_RECEIPT, RECEIPT).
 * Total length 222 chars.
 *
 * Per spec example: a receipt for ₪5,000 split across 5 cheques of
 * ₪1,000 yields 1 C100 + 5 D120 records (one per cheque). Same for
 * credit-card instalment plans: 1 D120 per instalment, unless the
 * source software can't enumerate them, in which case a single
 * D120 carries the total.
 */

import type { FieldSpec } from "../types";
import { serializeRecord } from "./serializer";

export interface D120Record {
  recordCode: "D120";
  /** 1301 — running line number in BKMVDATA. */
  recordSequence: string;
  /** 1302 — business VAT number. */
  vatNumber: string;
  /** 1303 — document type (matches the parent C100). */
  documentType: string;
  /** 1304 — document number (matches the parent C100). */
  documentNumber: string;
  /** 1305 — line number within the document (1-based). */
  lineNumber: string;
  /**
   * 1306 — payment method (1 digit):
   *   1=cash, 2=cheque, 3=credit card, 4=bank transfer, 5=gift voucher,
   *   6=replacement voucher, 7=promissory note, 8=standing order, 9=other
   */
  paymentMethod: string;
  /** 1307 — bank number (cheque only, 10 digits). */
  bankNumber?: string;
  /** 1308 — branch number (cheque only, 10 digits). */
  branchNumber?: string;
  /** 1309 — account number (cheque only, 15 digits). */
  accountNumber?: string;
  /** 1310 — cheque number (cheque only, 10 digits). */
  chequeNumber?: string;
  /** 1311 — payment / cheque-clearing date YYYYMMDD. */
  paymentDate?: string;
  /** 1312 — line amount (signed, X9(12)v99). */
  lineAmount: string;
  /**
   * 1313 — credit-card clearing company (1 digit):
   *   1=Isracard, 2=CAL, 3=Diners, 4=Amex, 6=Leumi Card
   */
  clearingCompanyCode?: string;
  /** 1314 — card name (20 chars). */
  cardName?: string;
  /**
   * 1315 — credit-card transaction type (1 digit):
   *   1=regular, 2=instalments, 3=credit, 4=deferred charge, 5=other
   */
  creditTransactionType?: string;
  /** 1320 — branch ID (mandatory when A000 field 1034 = 1). */
  branchId?: string;
  /** 1322 — document date YYYYMMDD. */
  documentDate: string;
  /** 1323 — internal linking field to C100 header. */
  linkingFieldToHeader?: string;
  /** 1324 — reserved (60 chars). */
  reservedFutureUse?: string;
}

export const D120_FIELDS: readonly FieldSpec[] = [
  { name: "recordCode", fieldNumber: 1300, start: 1, length: 4, type: "text", mandatory: true, value: "D120" },
  { name: "recordSequence", fieldNumber: 1301, start: 5, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "vatNumber", fieldNumber: 1302, start: 14, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "documentType", fieldNumber: 1303, start: 23, length: 3, type: "numeric", mandatory: true, pad: "0" },
  { name: "documentNumber", fieldNumber: 1304, start: 26, length: 20, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "lineNumber", fieldNumber: 1305, start: 46, length: 4, type: "numeric", mandatory: true, pad: "0" },
  { name: "paymentMethod", fieldNumber: 1306, start: 50, length: 1, type: "numeric", mandatory: true, pad: "0" },
  { name: "bankNumber", fieldNumber: 1307, start: 51, length: 10, type: "numeric", mandatory: false, pad: "0" },
  { name: "branchNumber", fieldNumber: 1308, start: 61, length: 10, type: "numeric", mandatory: false, pad: "0" },
  { name: "accountNumber", fieldNumber: 1309, start: 71, length: 15, type: "numeric", mandatory: false, pad: "0" },
  { name: "chequeNumber", fieldNumber: 1310, start: 86, length: 10, type: "numeric", mandatory: false, pad: "0" },
  { name: "paymentDate", fieldNumber: 1311, start: 96, length: 8, type: "date", mandatory: false },
  { name: "lineAmount", fieldNumber: 1312, start: 104, length: 15, type: "signedNumeric", mandatory: true, decimals: 2 },
  { name: "clearingCompanyCode", fieldNumber: 1313, start: 119, length: 1, type: "numeric", mandatory: false, pad: "0" },
  { name: "cardName", fieldNumber: 1314, start: 120, length: 20, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "creditTransactionType", fieldNumber: 1315, start: 140, length: 1, type: "numeric", mandatory: false, pad: "0" },
  { name: "branchId", fieldNumber: 1320, start: 141, length: 7, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "documentDate", fieldNumber: 1322, start: 148, length: 8, type: "date", mandatory: true },
  { name: "linkingFieldToHeader", fieldNumber: 1323, start: 156, length: 7, type: "numeric", mandatory: false, pad: "0" },
  { name: "reservedFutureUse", fieldNumber: 1324, start: 163, length: 60, type: "text", mandatory: false, justify: "left", pad: " " },
];

export const D120_TOTAL_LENGTH = 222;

export function serializeD120(record: D120Record): string {
  return serializeRecord(D120_FIELDS, record, D120_TOTAL_LENGTH);
}
