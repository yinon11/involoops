import { DETAILED_FIELDS } from "./fields";
import {
  formatDdMmYy,
  formatMoveinAmount,
  formatNumeric,
  formatText,
} from "./formatters";
import { encodeMoveinText } from "./parse";
import { MOVEIN_DETAILED_RECORD_LENGTH } from "./types";

export interface MoveinJournalLine {
  movementType?: string;
  reference1?: string;
  referenceDate: Date;
  reference2?: string;
  valueDate?: Date;
  currency?: string;
  details?: string;
  debitAccount1?: string;
  debitAccount2?: string;
  creditAccount1?: string;
  creditAccount2?: string;
  ilsDebit1?: number;
  ilsDebit2?: number;
  ilsCredit1?: number;
  ilsCredit2?: number;
  fxDebit1?: number;
  fxDebit2?: number;
  fxCredit1?: number;
  fxCredit2?: number;
}

function buildDetailedRecord(values: Record<string, string>): string {
  const parts: string[] = [];
  for (const spec of DETAILED_FIELDS) {
    if (spec.name === "terminator") {
      parts.push("\r\n");
      continue;
    }
    const width = spec.end - spec.start + 1;
    const raw = values[spec.name] ?? "";
    if (raw.length > width) {
      throw new Error(`Field ${spec.name} width ${raw.length} > ${width}`);
    }
    parts.push(
      raw.length === width ? raw : raw.padEnd(width, " "),
    );
  }
  const line = parts.join("");
  if (line.length !== MOVEIN_DETAILED_RECORD_LENGTH) {
    throw new Error(
      `Detailed MOVEIN record length ${line.length} !== ${MOVEIN_DETAILED_RECORD_LENGTH}`,
    );
  }
  return line;
}

/**
 * Header movement count is 3 chars (max 999). Per Hashavshevet spec, write `0`
 * when the count is unknown or exceeds the field width — import still works.
 */
export function formatHeaderMovementCount(movementCount: number): string {
  if (movementCount < 1 || movementCount > 999) {
    return formatNumeric(0, 3, "headerCount");
  }
  return formatNumeric(movementCount, 3, "headerCount");
}

export function serializeDetailedHeader(movementCount: number): string {
  return buildDetailedRecord({
    movementType: formatHeaderMovementCount(movementCount),
  });
}

export function serializeDetailedLine(line: MoveinJournalLine): string {
  const valueDate = line.valueDate ?? line.referenceDate;
  return buildDetailedRecord({
    movementType: formatText(line.movementType ?? "", 3, "right"),
    reference1: formatNumeric(line.reference1 ?? "", 5, "reference1"),
    referenceDate: formatDdMmYy(line.referenceDate, "referenceDate"),
    reference2: formatNumeric(line.reference2 ?? "", 5, "reference2"),
    valueDate: formatDdMmYy(valueDate, "valueDate"),
    currency: formatText(line.currency ?? "", 3),
    details: formatText(line.details ?? "", 22),
    debitAccount1: formatText(line.debitAccount1 ?? "", 8),
    debitAccount2: formatText(line.debitAccount2 ?? "", 8),
    creditAccount1: formatText(line.creditAccount1 ?? "", 8),
    creditAccount2: formatText(line.creditAccount2 ?? "", 8),
    ilsDebit1: line.ilsDebit1 ? formatMoveinAmount(line.ilsDebit1) : "",
    ilsDebit2: line.ilsDebit2 ? formatMoveinAmount(line.ilsDebit2) : "",
    ilsCredit1: line.ilsCredit1 ? formatMoveinAmount(line.ilsCredit1) : "",
    ilsCredit2: line.ilsCredit2 ? formatMoveinAmount(line.ilsCredit2) : "",
    fxDebit1: line.fxDebit1 ? formatMoveinAmount(line.fxDebit1) : "",
    fxDebit2: line.fxDebit2 ? formatMoveinAmount(line.fxDebit2) : "",
    fxCredit1: line.fxCredit1 ? formatMoveinAmount(line.fxCredit1) : "",
    fxCredit2: line.fxCredit2 ? formatMoveinAmount(line.fxCredit2) : "",
  });
}

export function serializeDetailedMovein(lines: MoveinJournalLine[]): Buffer {
  const chunks = [
    serializeDetailedHeader(lines.length),
    ...lines.map((l) => serializeDetailedLine(l)),
  ];
  return encodeMoveinText(chunks.join(""));
}
