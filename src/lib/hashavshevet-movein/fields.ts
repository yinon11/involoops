import type { MoveinFieldSpec } from "./types";

/** 1-based positions from the Hashavshevet detailed (180-char) annex. */
export const DETAILED_FIELDS: MoveinFieldSpec[] = [
  { name: "movementType", start: 1, end: 3 },
  { name: "reference1", start: 4, end: 8 },
  { name: "referenceDate", start: 9, end: 14 },
  { name: "reference2", start: 15, end: 19 },
  { name: "valueDate", start: 20, end: 25 },
  { name: "currency", start: 26, end: 28 },
  { name: "details", start: 29, end: 50 },
  { name: "debitAccount1", start: 51, end: 58 },
  { name: "debitAccount2", start: 59, end: 66 },
  { name: "creditAccount1", start: 67, end: 74 },
  { name: "creditAccount2", start: 75, end: 82 },
  { name: "ilsDebit1", start: 83, end: 94 },
  { name: "ilsDebit2", start: 95, end: 106 },
  { name: "ilsCredit1", start: 107, end: 118 },
  { name: "ilsCredit2", start: 119, end: 130 },
  { name: "fxDebit1", start: 131, end: 142 },
  { name: "fxDebit2", start: 143, end: 154 },
  { name: "fxCredit1", start: 155, end: 166 },
  { name: "fxCredit2", start: 167, end: 178 },
  { name: "terminator", start: 179, end: 180 },
];

/** Short (90-char) layout — movement + refs + one debit/credit pair + amounts. */
export const SHORT_FIELDS: MoveinFieldSpec[] = [
  { name: "movementType", start: 1, end: 3 },
  { name: "reference1", start: 4, end: 8 },
  { name: "referenceDate", start: 9, end: 14 },
  { name: "debitAccount1", start: 15, end: 22 },
  { name: "creditAccount1", start: 23, end: 30 },
  { name: "ilsDebit1", start: 31, end: 42 },
  { name: "ilsCredit1", start: 43, end: 54 },
  { name: "details", start: 55, end: 76 },
  { name: "filler", start: 77, end: 88 },
  { name: "terminator", start: 89, end: 90 },
];

export function sliceField(record: string, spec: MoveinFieldSpec): string {
  return record.slice(spec.start - 1, spec.end);
}

export function fieldMap(
  record: string,
  specs: MoveinFieldSpec[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of specs) {
    out[spec.name] = sliceField(record, spec);
  }
  return out;
}
