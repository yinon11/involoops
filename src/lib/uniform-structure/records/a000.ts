/**
 * A000 — INI.TXT lead record. Exactly one per file (always the
 * first line). Mirrors v1.31 §3.1 (חוברת הוראות 1/5/2009) field
 * by field — total 466 chars.
 *
 * Every reserved field carries spaces (or `!` per spec §2.4(ט)(1));
 * we emit spaces. Cancelled fields with length 0 are simply omitted
 * from the FIELDS array — they don't contribute to the byte count.
 */

import type { FieldSpec } from "../types";
import { serializeRecord } from "./serializer";

export interface A000Record {
  recordCode: "A000";
  /** 1001 — reserved for future use (5 chars). */
  reservedFutureUse1?: string;
  /** 1002 — total records in the matching BKMVDATA file (must equal Z900 field 1155). */
  totalRecordsInBkmvdata: string;
  /** 1003 — business VAT number (9 digits). */
  vatNumber: string;
  /** 1004 — primary ID (15 random digits, shared with A100/Z900). */
  primaryId: string;
  /** 1005 — system constant `&OF1.31&` (8 chars). */
  systemConstant: string;
  /** 1006 — software registration code (8 digits). */
  softwareRegistrationCode: string;
  /** 1007 — software name (20 chars). */
  softwareName: string;
  /** 1008 — software version (20 chars). */
  softwareVersion: string;
  /** 1009 — software house VAT number (9 digits). */
  softwareHouseVatNumber: string;
  /** 1010 — software house name (20 chars). */
  softwareHouseName: string;
  /** 1011 — software type: 1=single-year, 2=multi-year. */
  softwareType: string;
  /** 1012 — file path on the user's disk (50 chars; spec §2.2). */
  filePath: string;
  /** 1013 — accounting method: 1=single-entry, 2=double-entry, 0=N/A. */
  accountingMethod: string;
  /** 1014 — accounting balance level (1=transaction, 2=batch); only required for double-entry. */
  accountingBalanceRequired?: string;
  /** 1015 — company registration number (חברה ברשם החברות, 9 digits, optional). */
  companyRegistrationNumber?: string;
  /** 1016 — withholding file number (תיק ניכויים, 9 digits, optional). */
  withholdingFileNumber?: string;
  /** 1017 — reserved for future use (10 chars). */
  reservedFutureUse2?: string;
  /** 1018 — business name (50 chars). */
  businessName: string;
  /** 1019 — business address: street (50 chars). */
  businessStreet?: string;
  /** 1020 — business address: house number (10 chars). */
  businessHouseNumber?: string;
  /** 1021 — business address: city (30 chars). */
  businessCity?: string;
  /** 1022 — business address: zip (8 chars). */
  businessZip?: string;
  /** 1023 — tax year (4 digits). Mandatory only for single-year filings. */
  taxYear?: string;
  /** 1024 — data range start YYYYMMDD. Mandatory only for multi-year filings. */
  dataPeriodStart?: string;
  /** 1025 — data range end YYYYMMDD. Mandatory only for multi-year filings. */
  dataPeriodEnd?: string;
  /** 1026 — process start date YYYYMMDD. */
  processStartDate: string;
  /** 1027 — process start time HHMM (4 digits). */
  processStartTime: string;
  /** 1028 — language code (0=Hebrew, 1=Arabic, 2=Other). */
  languageCode: string;
  /** 1029 — charset code (1=ISO-8859-8-i, 2=CP-862). */
  charset: string;
  /** 1030 — name of the compression software used (20 chars). */
  compressionSoftwareName: string;
  /** 1032 — leading currency code (3 chars; default ILS). */
  leadingCurrency: string;
  /** 1034 — branch info: 1=has branches, 0=none. */
  branchInfo: string;
  /** 1035 — reserved for future use (46 chars). */
  reservedFutureUse3?: string;
}

export const A000_FIELDS: readonly FieldSpec[] = [
  { name: "recordCode", fieldNumber: 1000, start: 1, length: 4, type: "text", mandatory: true, value: "A000" },
  { name: "reservedFutureUse1", fieldNumber: 1001, start: 5, length: 5, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "totalRecordsInBkmvdata", fieldNumber: 1002, start: 10, length: 15, type: "numeric", mandatory: true, pad: "0" },
  { name: "vatNumber", fieldNumber: 1003, start: 25, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "primaryId", fieldNumber: 1004, start: 34, length: 15, type: "numeric", mandatory: true, pad: "0" },
  { name: "systemConstant", fieldNumber: 1005, start: 49, length: 8, type: "text", mandatory: true, justify: "left", pad: " ", value: "&OF1.31&" },
  { name: "softwareRegistrationCode", fieldNumber: 1006, start: 57, length: 8, type: "numeric", mandatory: true, pad: "0" },
  { name: "softwareName", fieldNumber: 1007, start: 65, length: 20, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "softwareVersion", fieldNumber: 1008, start: 85, length: 20, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "softwareHouseVatNumber", fieldNumber: 1009, start: 105, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "softwareHouseName", fieldNumber: 1010, start: 114, length: 20, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "softwareType", fieldNumber: 1011, start: 134, length: 1, type: "numeric", mandatory: true, pad: "0" },
  { name: "filePath", fieldNumber: 1012, start: 135, length: 50, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "accountingMethod", fieldNumber: 1013, start: 185, length: 1, type: "numeric", mandatory: true, pad: "0" },
  { name: "accountingBalanceRequired", fieldNumber: 1014, start: 186, length: 1, type: "numeric", mandatory: false, pad: "0" },
  { name: "companyRegistrationNumber", fieldNumber: 1015, start: 187, length: 9, type: "numeric", mandatory: false, pad: "0" },
  { name: "withholdingFileNumber", fieldNumber: 1016, start: 196, length: 9, type: "numeric", mandatory: false, pad: "0" },
  { name: "reservedFutureUse2", fieldNumber: 1017, start: 205, length: 10, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "businessName", fieldNumber: 1018, start: 215, length: 50, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "businessStreet", fieldNumber: 1019, start: 265, length: 50, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "businessHouseNumber", fieldNumber: 1020, start: 315, length: 10, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "businessCity", fieldNumber: 1021, start: 325, length: 30, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "businessZip", fieldNumber: 1022, start: 355, length: 8, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "taxYear", fieldNumber: 1023, start: 363, length: 4, type: "numeric", mandatory: false, pad: "0" },
  { name: "dataPeriodStart", fieldNumber: 1024, start: 367, length: 8, type: "date", mandatory: false },
  { name: "dataPeriodEnd", fieldNumber: 1025, start: 375, length: 8, type: "date", mandatory: false },
  { name: "processStartDate", fieldNumber: 1026, start: 383, length: 8, type: "date", mandatory: true },
  { name: "processStartTime", fieldNumber: 1027, start: 391, length: 4, type: "numeric", mandatory: true, pad: "0" },
  { name: "languageCode", fieldNumber: 1028, start: 395, length: 1, type: "numeric", mandatory: true, pad: "0" },
  { name: "charset", fieldNumber: 1029, start: 396, length: 1, type: "numeric", mandatory: true, pad: "0" },
  { name: "compressionSoftwareName", fieldNumber: 1030, start: 397, length: 20, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "leadingCurrency", fieldNumber: 1032, start: 417, length: 3, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "branchInfo", fieldNumber: 1034, start: 420, length: 1, type: "numeric", mandatory: true, pad: "0" },
  { name: "reservedFutureUse3", fieldNumber: 1035, start: 421, length: 46, type: "text", mandatory: false, justify: "left", pad: " " },
];

export const A000_TOTAL_LENGTH = 466;

export function serializeA000(record: A000Record): string {
  return serializeRecord(A000_FIELDS, record, A000_TOTAL_LENGTH);
}
