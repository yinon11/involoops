import {
  hasNonEmptyAccount,
  isValidDdMmYy,
  parseHeaderCount,
  parseMoveinAmount,
  parseMoveinFile,
  recordTerminatorOk,
} from "./parse";
import { parseMoveinPrm } from "./prm";
import type {
  MoveinMethod,
  MoveinValidationIssue,
  MoveinValidationResult,
} from "./types";

export function validateMoveinFile(params: {
  data: Buffer;
  prm?: Buffer;
  method?: MoveinMethod;
}): MoveinValidationResult {
  const errors: MoveinValidationIssue[] = [];
  const warnings: MoveinValidationIssue[] = [];

  let prmText: string | undefined;
  if (params.prm) {
    try {
      prmText = params.prm.toString("utf8");
      parseMoveinPrm(prmText);
    } catch (err) {
      errors.push({
        recordNumber: 0,
        field: "MOVEIN.PRM",
        rule: "prm_parse",
        message: err instanceof Error ? err.message : "Invalid PRM file",
      });
      return {
        valid: false,
        method: params.method ?? "flexible",
        recordLength: 0,
        errors,
        warnings,
        movementCount: 0,
        headerDeclaredCount: null,
      };
    }
  }

  let parsed;
  try {
    parsed = parseMoveinFile({
      data: params.data,
      prmText,
      method: params.method,
    });
  } catch (err) {
    errors.push({
      recordNumber: 0,
      field: "<file>",
      rule: "parse",
      message: err instanceof Error ? err.message : "Failed to parse MOVEIN data",
    });
    return {
      valid: false,
      method: params.method ?? "detailed",
      recordLength: 0,
      errors,
      warnings,
      movementCount: 0,
      headerDeclaredCount: null,
    };
  }

  const { records, recordLength, method } = parsed;
  if (records.length === 0) {
    errors.push({
      recordNumber: 0,
      field: "<file>",
      rule: "empty",
      message: "MOVEIN data file has no records",
    });
  }

  for (const rec of records) {
    const byteLen = Buffer.byteLength(rec.raw, "binary");
    if (byteLen !== recordLength) {
      errors.push({
        recordNumber: rec.recordNumber,
        field: "<record>",
        rule: "record_length",
        message: `Record ${rec.recordNumber} is ${byteLen} bytes, expected ${recordLength}`,
      });
    }

    if (!recordTerminatorOk(rec.raw)) {
      errors.push({
        recordNumber: rec.recordNumber,
        field: "terminator",
        rule: "crlf",
        message: `Record ${rec.recordNumber} must end with CR+LF`,
      });
    }

    if (rec.isHeader) {
      const term = rec.fields.terminator ?? "";
      if (term !== "\r\n") {
        errors.push({
          recordNumber: rec.recordNumber,
          field: "terminator",
          rule: "header_crlf",
          message: "Header record terminator must be CR+LF at record end",
        });
      }
      continue;
    }

    validateMovementRecord(rec.recordNumber, rec.fields, errors, warnings);
  }

  const headerDeclaredCount = records[0]
    ? parseHeaderCount(records[0].fields)
    : null;
  const movementCount = Math.max(0, records.length - 1);

  // Header `0` means "unknown" in Hashavshevet — valid when count > 999.
  if (
    headerDeclaredCount !== null &&
    headerDeclaredCount !== 0 &&
    headerDeclaredCount !== movementCount
  ) {
    warnings.push({
      recordNumber: 1,
      field: "movementType",
      rule: "header_count_mismatch",
      message: `Header declares ${headerDeclaredCount} movements but file has ${movementCount} data records`,
    });
  }

  return {
    valid: errors.length === 0,
    method,
    recordLength,
    errors,
    warnings,
    movementCount,
    headerDeclaredCount,
  };
}

function validateMovementRecord(
  recordNumber: number,
  fields: Record<string, string>,
  errors: MoveinValidationIssue[],
  warnings: MoveinValidationIssue[],
): void {
  const debitAccounts = [
    fields.debitAccount1,
    fields.debitAccount2,
  ].filter(Boolean) as string[];
  const creditAccounts = [
    fields.creditAccount1,
    fields.creditAccount2,
  ].filter(Boolean) as string[];

  if (!hasNonEmptyAccount(...debitAccounts, ...creditAccounts)) {
    errors.push({
      recordNumber,
      field: "accounts",
      rule: "account_required",
      message: "Each movement must have at least one debit or credit account",
    });
  }

  const ilsDebits = [
    parseMoveinAmount(fields.ilsDebit1 ?? ""),
    parseMoveinAmount(fields.ilsDebit2 ?? ""),
  ];
  const ilsCredits = [
    parseMoveinAmount(fields.ilsCredit1 ?? ""),
    parseMoveinAmount(fields.ilsCredit2 ?? ""),
  ];
  const fxDebits = [
    parseMoveinAmount(fields.fxDebit1 ?? ""),
    parseMoveinAmount(fields.fxDebit2 ?? ""),
  ];
  const fxCredits = [
    parseMoveinAmount(fields.fxCredit1 ?? ""),
    parseMoveinAmount(fields.fxCredit2 ?? ""),
  ];

  const totalIlsDebit = ilsDebits.reduce((a, b) => a + b, 0);
  const totalIlsCredit = ilsCredits.reduce((a, b) => a + b, 0);
  const totalFxDebit = fxDebits.reduce((a, b) => a + b, 0);
  const totalFxCredit = fxCredits.reduce((a, b) => a + b, 0);

  const hasIlsAmount = totalIlsDebit > 0 || totalIlsCredit > 0;
  const hasFxAmount = totalFxDebit > 0 || totalFxCredit > 0;

  if (!hasIlsAmount && !hasFxAmount) {
    errors.push({
      recordNumber,
      field: "amounts",
      rule: "amount_required",
      message: "Each movement must have at least one non-zero amount",
    });
  }

  if (totalIlsDebit > 0 && totalIlsCredit > 0) {
    const diff = Math.abs(totalIlsDebit - totalIlsCredit);
    if (diff > 0.01) {
      errors.push({
        recordNumber,
        field: "amounts",
        rule: "ils_balance",
        message: `Compound ILS entry not balanced: debit ${totalIlsDebit.toFixed(2)} ≠ credit ${totalIlsCredit.toFixed(2)}`,
      });
    }
  }

  if (totalFxDebit > 0 && totalFxCredit > 0) {
    const diff = Math.abs(totalFxDebit - totalFxCredit);
    if (diff > 0.01) {
      errors.push({
        recordNumber,
        field: "amounts",
        rule: "fx_balance",
        message: `Compound FX entry not balanced: debit ${totalFxDebit.toFixed(2)} ≠ credit ${totalFxCredit.toFixed(2)}`,
      });
    }
  }

  for (const [field, raw] of Object.entries(fields)) {
    if (!field.includes("Date") || field === "valueDate") continue;
    if (field === "referenceDate" || field === "valueDate") {
      if (raw?.trim() && !isValidDdMmYy(raw)) {
        warnings.push({
          recordNumber,
          field,
          rule: "date_format",
          message: `${field} "${raw.trim()}" is not DDMMYY`,
        });
      }
    }
  }

  const currency = (fields.currency ?? "").trim();
  if (hasFxAmount && !currency) {
    warnings.push({
      recordNumber,
      field: "currency",
      rule: "fx_without_currency",
      message: "FX amounts present but currency code is empty",
    });
  }
}
