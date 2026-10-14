/**
 * Z900 — BKMVDATA closing record (v1.31 §4.2). Always the last
 * line in BKMVDATA.TXT. Sequence number equals the grand total of
 * records in the file (A100 + body + this Z900).
 *
 * Field 1155 (`totalRecords`) MUST equal A000 field 1002 — the
 * INI/BKMVDATA reconciliation hinge.
 */

import type { FieldSpec } from "../types";
import { serializeRecord } from "./serializer";

export interface Z900Record {
  recordCode: "Z900";
  /** 1151 — running line number; equals total records in file. */
  recordSequence: string;
  /** 1152 — business VAT number. */
  vatNumber: string;
  /** 1153 — primary ID; same value as A000 field 1004 + A100 field 1103. */
  primaryId: string;
  /** 1154 — system constant `&OF1.31&`. */
  systemConstant: string;
  /** 1155 — total records in file (including A100 + Z900). */
  totalRecords: string;
  /** 1156 — reserved (50 chars). */
  reservedFutureUse?: string;
}

export const Z900_FIELDS: readonly FieldSpec[] = [
  { name: "recordCode", fieldNumber: 1150, start: 1, length: 4, type: "text", mandatory: true, value: "Z900" },
  { name: "recordSequence", fieldNumber: 1151, start: 5, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "vatNumber", fieldNumber: 1152, start: 14, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "primaryId", fieldNumber: 1153, start: 23, length: 15, type: "numeric", mandatory: true, pad: "0" },
  { name: "systemConstant", fieldNumber: 1154, start: 38, length: 8, type: "text", mandatory: true, justify: "left", pad: " ", value: "&OF1.31&" },
  { name: "totalRecords", fieldNumber: 1155, start: 46, length: 15, type: "numeric", mandatory: true, pad: "0" },
  { name: "reservedFutureUse", fieldNumber: 1156, start: 61, length: 50, type: "text", mandatory: false, justify: "left", pad: " " },
];

export const Z900_TOTAL_LENGTH = 110;

export function serializeZ900(record: Z900Record): string {
  return serializeRecord(Z900_FIELDS, record, Z900_TOTAL_LENGTH);
}
