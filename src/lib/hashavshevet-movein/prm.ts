import type { MoveinFieldSpec } from "./types";

/** Parsed MOVEIN.PRM — flexible import method (H-ERP annex א). */
export interface ParsedMoveinPrm {
  recordLength: number;
  fields: MoveinFieldSpec[];
}

const PRM_FIELD_NAMES = [
  "movementType",
  "reference1",
  "reference2",
  "referenceDate",
  "valueDate",
  "allocationCode",
  "currency",
  "quantity",
  "file",
  "details",
  "debitAccount1",
  "debitAccount2",
  "creditAccount1",
  "creditAccount2",
  "ilsDebit1",
  "ilsDebit2",
  "ilsCredit1",
  "ilsCredit2",
  "fxDebit1",
  "fxDebit2",
  "fxCredit1",
  "fxCredit2",
  "reference3",
  "reference4",
  "reference5",
  "notes",
  "notes2",
  "reference6",
  "reference7",
  "reference8",
  "reference9",
  "reference10",
  "reference11",
  "reference12",
] as const;

/**
 * Parse a MOVEIN.PRM parameter file.
 * Line 1 = total record length; lines 2+ = `start,end;` per field (1-based).
 */
export function parseMoveinPrm(text: string): ParsedMoveinPrm {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error("MOVEIN.PRM is empty");
  }

  // Record length line: `526 ;גודל הרשומה` — the number may be followed by `;`
  // and a Hebrew comment.
  const recordLengthMatch = lines[0].match(/^(\d+)/);
  const recordLength = recordLengthMatch ? Number(recordLengthMatch[1]) : NaN;
  if (!Number.isInteger(recordLength) || recordLength <= 2) {
    throw new Error(`MOVEIN.PRM line 1 must be a positive record length, got: ${lines[0]}`);
  }

  const fields: MoveinFieldSpec[] = [];
  for (let i = 1; i < lines.length && i <= PRM_FIELD_NAMES.length; i++) {
    // Seen in the wild as `start end ;comment` (space); the spec also allows
    // `start,end;`.
    const body = lines[i].split(";")[0]?.trim() ?? "";
    const match = body.match(/^(\d+)\s*[, ]\s*(\d+)\s*$/);
    if (!match) {
      throw new Error(`MOVEIN.PRM line ${i + 1}: expected start,end; got: ${lines[i]}`);
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    // Unused slots are marked `0 0 ;…` — skip them.
    if (start === 0 && end === 0) {
      continue;
    }
    if (start < 1 || end < start || end > recordLength) {
      throw new Error(
        `MOVEIN.PRM line ${i + 1}: invalid range ${start},${end} for record length ${recordLength}`,
      );
    }
    fields.push({
      name: PRM_FIELD_NAMES[fields.length] ?? `field${fields.length + 1}`,
      start,
      end,
    });
  }

  return { recordLength, fields };
}
