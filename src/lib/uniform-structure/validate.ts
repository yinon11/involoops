import iconv from "iconv-lite";
import { A000_TOTAL_LENGTH } from "./records/a000";
import { A100_TOTAL_LENGTH } from "./records/a100";
import { B110_TOTAL_LENGTH } from "./records/b110";
import { C100_TOTAL_LENGTH } from "./records/c100";
import { D110_TOTAL_LENGTH } from "./records/d110";
import { D120_TOTAL_LENGTH } from "./records/d120";
import { M100_TOTAL_LENGTH } from "./records/m100";
import { INI_SUMMARY_TOTAL_LENGTH } from "./records/ini-summary";
import { Z900_TOTAL_LENGTH } from "./records/z900";
import {
  UNIFORM_STRUCTURE_ENCODING,
  UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
} from "./types";
import { isValidIsraeliVatNumber } from "./vat-checksum";

export interface ValidationIssue {
  recordType: string;
  recordNumber: number;
  field: string;
  rule: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  recordCounts: Record<string, number>;
}

const RECORD_LENGTHS: Record<string, number> = {
  A000: A000_TOTAL_LENGTH,
  A100: A100_TOTAL_LENGTH,
  B110: B110_TOTAL_LENGTH,
  C100: C100_TOTAL_LENGTH,
  D110: D110_TOTAL_LENGTH,
  D120: D120_TOTAL_LENGTH,
  M100: M100_TOTAL_LENGTH,
  Z900: Z900_TOTAL_LENGTH,
};

/**
 * Spec 10 — local lint for (INI, BKMVDATA) pairs. Covers ~80% of
 * what the ITA simulator will flag: encoding, CRLF discipline,
 * record-code catalogue, fixed-width record lengths, INI/BKMVDATA
 * count reconciliation, A100→Z900 boundary, C100→D110 nesting, date
 * formats, VAT checksum, system-constant + primary-ID consistency,
 * and Z900↔A000 total-record agreement. Field-position regressions
 * and conditional-mandatory gaps still require a real simulator run.
 */
export function validateUniformStructureFiles(params: {
  ini: Buffer;
  bkmvdata: Buffer;
}): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const recordCounts: Record<string, number> = {};

  // 1) Encoding round-trip — bytes must survive ISO-8859-8 decode/encode.
  const iniText = iconv.decode(params.ini, UNIFORM_STRUCTURE_ENCODING);
  const bkmvText = iconv.decode(params.bkmvdata, UNIFORM_STRUCTURE_ENCODING);
  const iniRoundtrip = iconv.encode(iniText, UNIFORM_STRUCTURE_ENCODING);
  const bkmvRoundtrip = iconv.encode(bkmvText, UNIFORM_STRUCTURE_ENCODING);
  if (!iniRoundtrip.equals(params.ini)) {
    errors.push({
      recordType: "A000",
      recordNumber: 0,
      field: "<file>",
      rule: "encoding_roundtrip",
      message: `INI.TXT bytes do not round-trip through ${UNIFORM_STRUCTURE_ENCODING}`,
    });
  }
  if (!bkmvRoundtrip.equals(params.bkmvdata)) {
    warnings.push({
      recordType: "<file>",
      recordNumber: 0,
      field: "<file>",
      rule: "encoding_roundtrip",
      message: `BKMVDATA.TXT bytes do not round-trip through ${UNIFORM_STRUCTURE_ENCODING}`,
    });
  }

  // 2) Line endings — CRLF only, no trailing CRLF after last record.
  if (/\r\r/.test(bkmvText) || /(?<!\r)\n/.test(bkmvText)) {
    errors.push({
      recordType: "<file>",
      recordNumber: 0,
      field: "<line-endings>",
      rule: "line_endings",
      message: "BKMVDATA has non-CRLF line breaks",
    });
  }
  if (bkmvText.endsWith("\r\n")) {
    errors.push({
      recordType: "<file>",
      recordNumber: 0,
      field: "<line-endings>",
      rule: "no_trailing_crlf",
      message: "BKMVDATA has a trailing CRLF after the last record",
    });
  }

  // 3) BKMVDATA records — code catalogue + widths + ordering +
  //    primary-ID consistency.
  const lines = bkmvText.split("\r\n");
  let seenA100 = false;
  let seenZ900 = false;
  let bkmvPrimaryId: string | null = null;
  let z900TotalClaim: number | null = null;
  lines.forEach((line, idx) => {
    const recordNumber = idx + 1;
    if (line.length < 4) {
      errors.push({
        recordType: "<unknown>",
        recordNumber,
        field: "<line>",
        rule: "line_too_short",
        message: `line ${recordNumber} has no record code`,
      });
      return;
    }
    const code = line.slice(0, 4);
    const expectedLength = RECORD_LENGTHS[code];
    if (expectedLength === undefined) {
      errors.push({
        recordType: code,
        recordNumber,
        field: "<record_code>",
        rule: "unknown_record_code",
        message: `line ${recordNumber} starts with unknown record code "${code}"`,
      });
      return;
    }
    recordCounts[code] = (recordCounts[code] ?? 0) + 1;
    if (line.length !== expectedLength) {
      errors.push({
        recordType: code,
        recordNumber,
        field: "<record>",
        rule: "record_length_mismatch",
        message: `line ${recordNumber} (${code}) is ${line.length} chars, expected ${expectedLength}`,
      });
      // Don't try to parse fields out of a malformed record.
      return;
    }

    if (code === "A100") {
      if (idx !== 0) {
        errors.push({
          recordType: "A100",
          recordNumber,
          field: "<order>",
          rule: "a100_not_first",
          message: "A100 must be the first record in BKMVDATA",
        });
      }
      seenA100 = true;
      // A100 field 1103 (primaryId) at chars 23..37 (0-indexed 22..37);
      // field 1104 (systemConstant) at chars 38..45.
      const primary = line.slice(22, 37);
      const constant = line.slice(37, 45);
      bkmvPrimaryId = primary;
      if (constant !== UNIFORM_STRUCTURE_SYSTEM_CONSTANT) {
        errors.push({
          recordType: "A100",
          recordNumber,
          field: "systemConstant",
          rule: "system_constant_mismatch",
          message: `A100 field 1104 is "${constant}", expected "${UNIFORM_STRUCTURE_SYSTEM_CONSTANT}"`,
        });
      }
    } else if (code === "Z900") {
      if (idx !== lines.length - 1) {
        errors.push({
          recordType: "Z900",
          recordNumber,
          field: "<order>",
          rule: "z900_not_last",
          message: "Z900 must be the last record in BKMVDATA",
        });
      }
      seenZ900 = true;
      const primary = line.slice(22, 37);
      const constant = line.slice(37, 45);
      const total = line.slice(45, 60);
      if (constant !== UNIFORM_STRUCTURE_SYSTEM_CONSTANT) {
        errors.push({
          recordType: "Z900",
          recordNumber,
          field: "systemConstant",
          rule: "system_constant_mismatch",
          message: `Z900 field 1154 is "${constant}", expected "${UNIFORM_STRUCTURE_SYSTEM_CONSTANT}"`,
        });
      }
      if (bkmvPrimaryId !== null && primary !== bkmvPrimaryId) {
        errors.push({
          recordType: "Z900",
          recordNumber,
          field: "primaryId",
          rule: "primary_id_mismatch",
          message: `Z900 primaryId "${primary}" differs from A100 "${bkmvPrimaryId}"`,
        });
      }
      z900TotalClaim = Number(total);
      if (!Number.isFinite(z900TotalClaim)) {
        errors.push({
          recordType: "Z900",
          recordNumber,
          field: "totalRecords",
          rule: "z900_total_unreadable",
          message: `Z900 field 1155 "${total}" is not numeric`,
        });
      } else if (z900TotalClaim !== lines.length) {
        errors.push({
          recordType: "Z900",
          recordNumber,
          field: "totalRecords",
          rule: "z900_total_mismatch",
          message: `Z900 claims ${z900TotalClaim} records, BKMVDATA has ${lines.length} lines`,
        });
      }
    }

    // C100 → D110 nesting check
    if (code === "D110" && !lastRecordWasC100Or("D110", lines, idx)) {
      errors.push({
        recordType: "D110",
        recordNumber,
        field: "<order>",
        rule: "d110_without_c100",
        message: "D110 must be preceded by a C100 (or another D110)",
      });
    }

    // C100 spot-check: documentIssueDate at 0-indexed 45..53.
    if (code === "C100") {
      const dateStr = line.slice(45, 53);
      if (!/^\d{8}$/.test(dateStr)) {
        errors.push({
          recordType: "C100",
          recordNumber,
          field: "documentIssueDate",
          rule: "date_format",
          message: `issue date "${dateStr}" is not YYYYMMDD`,
        });
      }
    }
  });

  if (!seenA100) {
    errors.push({
      recordType: "A100",
      recordNumber: 0,
      field: "<file>",
      rule: "missing_a100",
      message: "BKMVDATA missing A100 opening record",
    });
  }
  if (!seenZ900) {
    errors.push({
      recordType: "Z900",
      recordNumber: 0,
      field: "<file>",
      rule: "missing_z900",
      message: "BKMVDATA missing Z900 closing record",
    });
  }

  // 4) INI walk: line 1 is A000, the rest are 19-char §3.2 summary
  //    lines. A000 fields 1002 (totalRecordsInBkmvdata, chars 9..24),
  //    1004 (primaryId, chars 33..48), 1005 (systemConstant, chars 48..56).
  const iniLines = iniText.split("\r\n");
  let iniPrimaryId: string | null = null;
  let iniA000Total: number | null = null;
  iniLines.forEach((line, idx) => {
    const recordNumber = idx + 1;
    if (line.length < 4) {
      errors.push({
        recordType: "<unknown>",
        recordNumber,
        field: "<line>",
        rule: "ini_line_too_short",
        message: `INI line ${recordNumber} has no record code`,
      });
      return;
    }
    const code = line.slice(0, 4);
    if (idx === 0) {
      if (code !== "A000") {
        errors.push({
          recordType: code,
          recordNumber,
          field: "<order>",
          rule: "ini_first_not_a000",
          message: `INI must start with A000, got "${code}"`,
        });
      }
      if (line.length !== A000_TOTAL_LENGTH) {
        errors.push({
          recordType: "A000",
          recordNumber,
          field: "<record>",
          rule: "ini_a000_length_mismatch",
          message: `A000 is ${line.length} chars, expected ${A000_TOTAL_LENGTH}`,
        });
        return;
      }
      iniA000Total = Number(line.slice(9, 24));
      iniPrimaryId = line.slice(33, 48);
      const constant = line.slice(48, 56);
      if (constant !== UNIFORM_STRUCTURE_SYSTEM_CONSTANT) {
        errors.push({
          recordType: "A000",
          recordNumber,
          field: "systemConstant",
          rule: "system_constant_mismatch",
          message: `A000 field 1005 is "${constant}", expected "${UNIFORM_STRUCTURE_SYSTEM_CONSTANT}"`,
        });
      }
      if (!Number.isFinite(iniA000Total)) {
        errors.push({
          recordType: "A000",
          recordNumber,
          field: "totalRecordsInBkmvdata",
          rule: "a000_total_unreadable",
          message: `A000 field 1002 "${line.slice(9, 24)}" is not numeric`,
        });
      } else if (z900TotalClaim !== null && iniA000Total !== z900TotalClaim) {
        errors.push({
          recordType: "A000",
          recordNumber,
          field: "totalRecordsInBkmvdata",
          rule: "a000_z900_total_mismatch",
          message: `A000 field 1002 (${iniA000Total}) ≠ Z900 field 1155 (${z900TotalClaim})`,
        });
      }
      if (bkmvPrimaryId !== null && iniPrimaryId !== bkmvPrimaryId) {
        errors.push({
          recordType: "A000",
          recordNumber,
          field: "primaryId",
          rule: "primary_id_mismatch",
          message: `A000 primaryId "${iniPrimaryId}" differs from BKMVDATA "${bkmvPrimaryId}"`,
        });
      }
      return;
    }

    // Summary records — 19 chars, code (4) + count (15).
    if (line.length !== INI_SUMMARY_TOTAL_LENGTH) {
      errors.push({
        recordType: code,
        recordNumber,
        field: "<record>",
        rule: "ini_summary_length_mismatch",
        message: `INI summary is ${line.length} chars, expected ${INI_SUMMARY_TOTAL_LENGTH}`,
      });
      return;
    }
    if (RECORD_LENGTHS[code] === undefined) {
      errors.push({
        recordType: code,
        recordNumber,
        field: "<record_code>",
        rule: "ini_unknown_summary_code",
        message: `INI summary line ${recordNumber} has unknown code "${code}"`,
      });
      return;
    }
    const claimed = Number(line.slice(4, 19));
    if (!Number.isFinite(claimed)) {
      errors.push({
        recordType: code,
        recordNumber,
        field: "totalRecords",
        rule: "ini_summary_count_unreadable",
        message: `INI summary count "${line.slice(4, 19)}" is not numeric`,
      });
      return;
    }
    const actual = recordCounts[code] ?? 0;
    if (claimed !== actual) {
      errors.push({
        recordType: code,
        recordNumber,
        field: "totalRecords",
        rule: "ini_count_mismatch",
        message: `INI summary claims ${claimed} ${code} records, BKMVDATA has ${actual}`,
      });
    }
  });

  // 5) A000 VAT checksum — best-effort spot check.
  if (iniLines.length > 0 && iniLines[0].startsWith("A000")) {
    // A000 field 1003 (vatNumber) at chars 24..33 (0-indexed).
    const vat = iniLines[0].slice(24, 33);
    if (!isValidIsraeliVatNumber(vat)) {
      warnings.push({
        recordType: "A000",
        recordNumber: 1,
        field: "vatNumber",
        rule: "invalid_vat_checksum",
        message: `VAT number "${vat}" fails the Israeli checksum`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    recordCounts,
  };
}

function lastRecordWasC100Or(
  expected: string,
  lines: string[],
  idx: number,
): boolean {
  if (idx === 0) return false;
  const prev = lines[idx - 1].slice(0, 4);
  return prev === "C100" || prev === expected;
}
