/**
 * A100 — BKMVDATA opening record (v1.31 §4.1). Always the first
 * line in BKMVDATA.TXT. Sequence number is always 1.
 *
 * Per spec, the file's grand total record count lives in Z900 field
 * 1155 (and INI A000 field 1002), NOT in A100 — A100 carries only
 * identification + the system constant.
 */

import type { FieldSpec } from "../types";
import { serializeRecord } from "./serializer";

export interface A100Record {
  recordCode: "A100";
  /** 1101 — running line number; always "1" for A100. */
  recordSequence: string;
  /** 1102 — business VAT number. */
  vatNumber: string;
  /** 1103 — primary ID; same value as A000 field 1004 + Z900 field 1153. */
  primaryId: string;
  /** 1104 — system constant `&OF1.31&`. */
  systemConstant: string;
  /** 1105 — reserved (50 chars). */
  reservedFutureUse?: string;
}

export const A100_FIELDS: readonly FieldSpec[] = [
  { name: "recordCode", fieldNumber: 1100, start: 1, length: 4, type: "text", mandatory: true, value: "A100" },
  { name: "recordSequence", fieldNumber: 1101, start: 5, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "vatNumber", fieldNumber: 1102, start: 14, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "primaryId", fieldNumber: 1103, start: 23, length: 15, type: "numeric", mandatory: true, pad: "0" },
  { name: "systemConstant", fieldNumber: 1104, start: 38, length: 8, type: "text", mandatory: true, justify: "left", pad: " ", value: "&OF1.31&" },
  { name: "reservedFutureUse", fieldNumber: 1105, start: 46, length: 50, type: "text", mandatory: false, justify: "left", pad: " " },
];

export const A100_TOTAL_LENGTH = 95;

export function serializeA100(record: A100Record): string {
  return serializeRecord(A100_FIELDS, record, A100_TOTAL_LENGTH);
}
