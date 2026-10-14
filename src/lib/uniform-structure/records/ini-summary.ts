/**
 * INI summary record (v1.31 §3.2). Each non-A000 line in INI.TXT
 * is a 19-char summary: `recordCode` (4) + `totalRecords` (15).
 * One line per BKMVDATA record type that has at least one record:
 * A100, B100, B110, C100, D110, D120, M100, Z900.
 *
 * A100 and Z900 are bookend records — their summary count is
 * always 1.
 */

import type { FieldSpec } from "../types";
import { serializeRecord } from "./serializer";

export type IniSummaryRecordCode =
  | "A100"
  | "B100"
  | "B110"
  | "C100"
  | "D110"
  | "D120"
  | "M100"
  | "Z900";

export interface IniSummaryRecord {
  /** 1050 — the record code being summarised (e.g. `C100`). */
  recordCode: IniSummaryRecordCode;
  /** 1051 — number of those records in BKMVDATA.TXT. */
  totalRecords: string;
}

export const INI_SUMMARY_FIELDS: readonly FieldSpec[] = [
  { name: "recordCode", fieldNumber: 1050, start: 1, length: 4, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "totalRecords", fieldNumber: 1051, start: 5, length: 15, type: "numeric", mandatory: true, pad: "0" },
];

export const INI_SUMMARY_TOTAL_LENGTH = 19;

export function serializeIniSummary(record: IniSummaryRecord): string {
  return serializeRecord(INI_SUMMARY_FIELDS, record, INI_SUMMARY_TOTAL_LENGTH);
}
