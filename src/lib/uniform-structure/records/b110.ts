/**
 * B110 — chart-of-accounts entry (חשבון בהנהלת חשבונות) per
 * v1.31 §4.7. Total length 376 chars.
 *
 * InvoLoops is invoicing-only and has no general ledger, but the
 * Form 513 simulator expects B110 records when any A100 is present.
 * We emit a small set of synthetic system accounts (Revenue, VAT
 * Payable, etc.) with zero balances to satisfy the certification
 * check. Real bookkeeping software would walk its chart-of-accounts
 * table and emit one record per account.
 *
 * Per spec §2.4(יב): the opening balance (field 1414) carries an
 * explicit sign — `+` debit balance / `-` credit balance.
 *
 * Per spec, fields 1418 and 1420 are CANCELLED (length 0) — they
 * don't appear in the byte stream. Field 1419 starts at column 327
 * (immediately after 1417), and field 1421 starts at column 336
 * (immediately after 1419). Watch the column math when editing.
 */

import type { FieldSpec } from "../types";
import { serializeRecord } from "./serializer";

export interface B110Record {
  recordCode: "B110";
  /** 1401 — running line number in BKMVDATA. */
  recordSequence: string;
  /** 1402 — business VAT number. */
  vatNumber: string;
  /** 1403 — unique account key (15 chars, mandatory). */
  accountKey: string;
  /** 1404 — account name (50 chars, mandatory). */
  accountName: string;
  /** 1405 — trial-balance / sort code (15 chars, mandatory). */
  trialBalanceCode: string;
  /** 1406 — trial-balance code description (30 chars, mandatory). */
  trialBalanceCodeDescription: string;
  /** 1407 — customer/supplier address: street (50 chars, conditional). */
  customerSupplierStreet?: string;
  /** 1408 — customer/supplier address: house number (10 chars, conditional). */
  customerSupplierHouseNumber?: string;
  /** 1409 — customer/supplier address: city (30 chars, conditional). */
  customerSupplierCity?: string;
  /** 1410 — customer/supplier address: zip (8 chars, conditional). */
  customerSupplierZip?: string;
  /** 1411 — customer/supplier address: country (30 chars, conditional). */
  customerSupplierCountry?: string;
  /** 1412 — country code (ISO 3166-1 alpha-2, 2 chars, conditional). */
  countryCode?: string;
  /** 1413 — central / parent account key (15 chars, conditional). */
  centralAccount?: string;
  /** 1414 — opening balance at period start (signed X9(12)v99 → 15). */
  openingBalance: string;
  /** 1415 — total debits in period, excl. opening (X9(12)v99 → 15). */
  totalDebit: string;
  /** 1416 — total credits in period, excl. opening (X9(12)v99 → 15). */
  totalCredit: string;
  /** 1417 — Form 6111 accounting-classification code (4 digits, conditional). */
  accountClassificationCode?: string;
  /** 1419 — supplier/customer VAT number (9 digits, mandatory when A000 1013=2). */
  supplierCustomerVatNumber?: string;
  /** 1421 — branch ID (7 chars, mandatory when A000 1034=1). */
  branchId?: string;
  /** 1422 — opening balance in foreign currency (signed X9(12)v99 → 15, conditional). */
  foreignOpeningBalance?: string;
  /** 1423 — foreign-currency code (3 chars, conditional). */
  foreignCurrencyCode?: string;
  /** 1424 — reserved for future use (16 chars). */
  reservedFutureUse?: string;
}

export const B110_FIELDS: readonly FieldSpec[] = [
  { name: "recordCode", fieldNumber: 1400, start: 1, length: 4, type: "text", mandatory: true, value: "B110" },
  { name: "recordSequence", fieldNumber: 1401, start: 5, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "vatNumber", fieldNumber: 1402, start: 14, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "accountKey", fieldNumber: 1403, start: 23, length: 15, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "accountName", fieldNumber: 1404, start: 38, length: 50, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "trialBalanceCode", fieldNumber: 1405, start: 88, length: 15, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "trialBalanceCodeDescription", fieldNumber: 1406, start: 103, length: 30, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "customerSupplierStreet", fieldNumber: 1407, start: 133, length: 50, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerSupplierHouseNumber", fieldNumber: 1408, start: 183, length: 10, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerSupplierCity", fieldNumber: 1409, start: 193, length: 30, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerSupplierZip", fieldNumber: 1410, start: 223, length: 8, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "customerSupplierCountry", fieldNumber: 1411, start: 231, length: 30, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "countryCode", fieldNumber: 1412, start: 261, length: 2, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "centralAccount", fieldNumber: 1413, start: 263, length: 15, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "openingBalance", fieldNumber: 1414, start: 278, length: 15, type: "signedNumeric", mandatory: true, decimals: 2 },
  { name: "totalDebit", fieldNumber: 1415, start: 293, length: 15, type: "signedNumeric", mandatory: true, decimals: 2 },
  { name: "totalCredit", fieldNumber: 1416, start: 308, length: 15, type: "signedNumeric", mandatory: true, decimals: 2 },
  { name: "accountClassificationCode", fieldNumber: 1417, start: 323, length: 4, type: "numeric", mandatory: false, pad: "0" },
  // 1418 (cancelled, length 0) — omitted from FIELDS.
  { name: "supplierCustomerVatNumber", fieldNumber: 1419, start: 327, length: 9, type: "numeric", mandatory: false, pad: "0" },
  // 1420 (cancelled, length 0) — omitted from FIELDS.
  { name: "branchId", fieldNumber: 1421, start: 336, length: 7, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "foreignOpeningBalance", fieldNumber: 1422, start: 343, length: 15, type: "signedNumeric", mandatory: false, decimals: 2 },
  { name: "foreignCurrencyCode", fieldNumber: 1423, start: 358, length: 3, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "reservedFutureUse", fieldNumber: 1424, start: 361, length: 16, type: "text", mandatory: false, justify: "left", pad: " " },
];

export const B110_TOTAL_LENGTH = 376;

export function serializeB110(record: B110Record): string {
  return serializeRecord(B110_FIELDS, record, B110_TOTAL_LENGTH);
}
