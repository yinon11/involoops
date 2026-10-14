/**
 * Spec 10 — local verification harness for the v1.31 Uniform
 * Structure export. Pure scenarios (formatters, serializers,
 * validator) run without DATABASE_URL.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import iconv from "iconv-lite";
import {
  formatAmount,
  formatDate,
  formatNumeric,
  formatSignedNumeric,
  formatText,
  UniformStructureFieldError,
} from "@/lib/uniform-structure/formatters";
import { isValidIsraeliVatNumber } from "@/lib/uniform-structure/vat-checksum";
import {
  generatePrimaryId,
  UNIFORM_STRUCTURE_ENCODING,
  UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
} from "@/lib/uniform-structure/types";
import {
  serializeA000,
  A000_TOTAL_LENGTH,
  type A000Record,
} from "@/lib/uniform-structure/records/a000";
import {
  serializeA100,
  A100_TOTAL_LENGTH,
} from "@/lib/uniform-structure/records/a100";
import {
  serializeB110,
  B110_TOTAL_LENGTH,
} from "@/lib/uniform-structure/records/b110";
import {
  serializeC100,
  C100_TOTAL_LENGTH,
} from "@/lib/uniform-structure/records/c100";
import {
  serializeD110,
  D110_TOTAL_LENGTH,
} from "@/lib/uniform-structure/records/d110";
import {
  serializeD120,
  D120_TOTAL_LENGTH,
} from "@/lib/uniform-structure/records/d120";
import {
  serializeM100,
  M100_TOTAL_LENGTH,
} from "@/lib/uniform-structure/records/m100";
import {
  serializeIniSummary,
  INI_SUMMARY_TOTAL_LENGTH,
} from "@/lib/uniform-structure/records/ini-summary";
import {
  serializeZ900,
  Z900_TOTAL_LENGTH,
} from "@/lib/uniform-structure/records/z900";
import { documentTypeToCode } from "@/lib/uniform-structure/records/c100";
import { validateUniformStructureFiles } from "@/lib/uniform-structure/validate";

function loadEnvFile() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env */
  }
}

loadEnvFile();

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const badge = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${badge}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const VAT = "123456789";
const PRIMARY = "000000000000001";

function buildA000(overrides: Partial<A000Record> = {}): A000Record {
  return {
    recordCode: "A000",
    totalRecordsInBkmvdata: "2",
    vatNumber: VAT,
    primaryId: PRIMARY,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
    softwareRegistrationCode: "00000000",
    softwareName: "InvoLoops",
    softwareVersion: "1.0.0",
    softwareHouseVatNumber: "517193777",
    softwareHouseName: "TTP GO LTD",
    softwareType: "2",
    filePath: "\\OPENFRMT\\12345678.26\\04201205",
    accountingMethod: "0",
    businessName: "Test Business Ltd",
    taxYear: "0",
    dataPeriodStart: "2026-01-01",
    dataPeriodEnd: "2026-12-31",
    processStartDate: "2026-04-20",
    processStartTime: "1205",
    languageCode: "0",
    charset: "1",
    compressionSoftwareName: "ZIP",
    leadingCurrency: "ILS",
    branchInfo: "0",
    ...overrides,
  };
}

// --- 1. formatters --------------------------------------------------------

function scenarioFormatters() {
  const name = "1. formatters — text / numeric / signed / date / amount";
  const tests = [
    formatText("abc", 5) === "abc  ",
    formatText("abcdef", 4) === "abcd",
    formatText("abc", 5, "right") === "  abc",
    formatNumeric(42, 5) === "00042",
    formatNumeric("7", 4, " ") === "   7",
    formatSignedNumeric(-12.34, 10) === "-000001234",
    formatSignedNumeric(12.34, 10) === "+000001234",
    // X9(12)v9999 quantity → 17 wide, +/- + 16 digits, 4 decimals
    formatSignedNumeric(2.5, 17, 4) === "+0000000000025000",
    formatDate(new Date("2026-04-20T00:00:00Z")) === "20260420",
    formatDate("2026-04-20") === "20260420",
    formatDate("", 8, false) === "00000000", // empty optional date → 8 zeros
    formatAmount(1234.56, 15) === "000000000123456",
    formatAmount("0", 15) === "000000000000000",
    // VAT rate 17% as 9(2)v99 → 4 chars
    formatAmount(17, 4, 2) === "1700",
  ];
  const ok = tests.every(Boolean);
  record(name, ok, `${tests.filter(Boolean).length}/${tests.length} assertions`);
}

// --- 2. formatter errors --------------------------------------------------

function scenarioFormatterErrors() {
  const name = "2. formatter errors — boundary + mandatory";
  let mandatoryThrew = false;
  try {
    formatText("", 5, "left", " ", true, "test");
  } catch (e) {
    mandatoryThrew = e instanceof UniformStructureFieldError;
  }
  let overflowThrew = false;
  try {
    formatNumeric(1234567, 4);
  } catch (e) {
    overflowThrew = e instanceof UniformStructureFieldError;
  }
  let negativeAmountThrew = false;
  try {
    formatAmount(-1.23, 15);
  } catch (e) {
    negativeAmountThrew = e instanceof UniformStructureFieldError;
  }
  record(
    name,
    mandatoryThrew && overflowThrew && negativeAmountThrew,
    `${mandatoryThrew}/${overflowThrew}/${negativeAmountThrew}`,
  );
}

// --- 3. VAT checksum ------------------------------------------------------

function scenarioVatChecksum() {
  const name = "3. VAT checksum — valid + invalid";
  const ok =
    isValidIsraeliVatNumber("000000018") &&
    !isValidIsraeliVatNumber("123456789") &&
    !isValidIsraeliVatNumber("abcdefghi");
  record(name, ok);
}

// --- 4. record serialization meets v1.31 lengths -------------------------

function scenarioRecordLengths() {
  const name = "4. v1.31 record lengths";
  const a000 = serializeA000(buildA000());
  const a100 = serializeA100({
    recordCode: "A100",
    recordSequence: "1",
    vatNumber: VAT,
    primaryId: PRIMARY,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
  });
  const c100 = serializeC100({
    recordCode: "C100",
    recordSequence: "2",
    vatNumber: VAT,
    documentType: "305",
    documentNumber: "2026-TI-000001",
    documentIssueDate: "2026-04-20",
    documentIssueTime: "1200",
    customerName: "Widget Corp",
    customerStreet: "1 Rothschild",
    customerVatNumber: "987654321",
    valueDate: "2026-04-20",
    amountBeforeDiscount: "1000",
    amountAfterDiscountExVat: "1000",
    vatAmount: "180",
    amountIncludingVat: "1180",
    customerKey: "CUST-000000001",
    documentDate: "2026-04-20",
  });
  const d110 = serializeD110({
    recordCode: "D110",
    recordSequence: "3",
    vatNumber: VAT,
    documentType: "305",
    documentNumber: "2026-TI-000001",
    lineNumber: "1",
    internalSku: "SKU-ABCDEF01",
    itemDescription: "Widget service",
    unitOfMeasureDescription: "יחידה",
    quantity: "2",
    unitPriceExVat: "500",
    lineTotal: "1000",
    vatRate: "18",
    documentDate: "2026-04-20",
  });
  const d120 = serializeD120({
    recordCode: "D120",
    recordSequence: "4",
    vatNumber: VAT,
    documentType: "320",
    documentNumber: "2026-TR-000001",
    lineNumber: "1",
    paymentMethod: "1",
    paymentDate: "2026-04-20",
    lineAmount: "1180",
    documentDate: "2026-04-20",
  });
  const m100 = serializeM100({
    recordCode: "M100",
    recordSequence: "5",
    vatNumber: VAT,
    internalSku: "SKU-ABCDEF01",
    itemName: "Widget service",
    unitOfMeasureDescription: "יחידה",
    openingBalance: "0",
    totalEntries: "0",
    totalExits: "0",
  });
  const b110 = serializeB110({
    recordCode: "B110",
    recordSequence: "6",
    vatNumber: VAT,
    accountKey: "REV-MAIN",
    accountName: "הכנסות ממכירות",
    trialBalanceCode: "1000",
    trialBalanceCodeDescription: "הכנסות",
    openingBalance: "0",
    totalDebit: "0",
    totalCredit: "0",
  });
  const z900 = serializeZ900({
    recordCode: "Z900",
    recordSequence: "2",
    vatNumber: VAT,
    primaryId: PRIMARY,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
    totalRecords: "2",
  });
  const summary = serializeIniSummary({
    recordCode: "C100",
    totalRecords: "1",
  });
  const checks: Array<[string, number, number]> = [
    ["A000", a000.length, A000_TOTAL_LENGTH],
    ["A100", a100.length, A100_TOTAL_LENGTH],
    ["B110", b110.length, B110_TOTAL_LENGTH],
    ["C100", c100.length, C100_TOTAL_LENGTH],
    ["D110", d110.length, D110_TOTAL_LENGTH],
    ["D120", d120.length, D120_TOTAL_LENGTH],
    ["M100", m100.length, M100_TOTAL_LENGTH],
    ["Z900", z900.length, Z900_TOTAL_LENGTH],
    ["INI_SUMMARY", summary.length, INI_SUMMARY_TOTAL_LENGTH],
  ];
  const failures = checks.filter(([, got, want]) => got !== want);
  record(
    name,
    failures.length === 0,
    failures.length === 0
      ? checks.map(([n, g]) => `${n}=${g}`).join(" ")
      : failures.map(([n, g, w]) => `${n}: ${g} ≠ ${w}`).join("; "),
  );
}

// --- 5. document-type mappings (v1.31 §5.1) -----------------------------

function scenarioDocumentTypeCodes() {
  const name = "5. documentTypeToCode — v1.31 Annex 1 mappings";
  const expected: Record<string, string> = {
    TAX_INVOICE: "305",
    TAX_INVOICE_RECEIPT: "320",
    RECEIPT: "400",
    CREDIT_INVOICE: "330",
    PROFORMA: "300",
    DELIVERY_NOTE: "200",
  };
  const failures = Object.entries(expected).filter(
    ([t, want]) => documentTypeToCode(t) !== want,
  );
  record(
    name,
    failures.length === 0,
    failures.length === 0
      ? "all 6 mappings"
      : failures.map(([t, want]) => `${t}: got ${documentTypeToCode(t)}, want ${want}`).join("; "),
  );
}

// --- 6. system constant + primary ID round-trip -------------------------

function scenarioSystemConstants() {
  const name = "6. system constants — &OF1.31& and primaryId";
  const a000 = serializeA000(buildA000());
  const a100 = serializeA100({
    recordCode: "A100",
    recordSequence: "1",
    vatNumber: VAT,
    primaryId: PRIMARY,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
  });
  const z900 = serializeZ900({
    recordCode: "Z900",
    recordSequence: "2",
    vatNumber: VAT,
    primaryId: PRIMARY,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
    totalRecords: "2",
  });
  // A000 field 1005: chars 49..56 (1-indexed) = slice(48, 56)
  // A100 field 1104: chars 38..45 = slice(37, 45)
  // Z900 field 1154: chars 38..45 = slice(37, 45)
  const constants = [a000.slice(48, 56), a100.slice(37, 45), z900.slice(37, 45)];
  const allEqual = constants.every((c) => c === UNIFORM_STRUCTURE_SYSTEM_CONSTANT);
  // A000 field 1004: slice(33, 48), A100 field 1103: slice(22, 37),
  // Z900 field 1153: slice(22, 37).
  const ids = [a000.slice(33, 48), a100.slice(22, 37), z900.slice(22, 37)];
  const idsEqual = ids.every((i) => i === PRIMARY);
  record(
    name,
    allEqual && idsEqual,
    `constants=${JSON.stringify(constants)} ids=${JSON.stringify(ids)}`,
  );
}

// --- 7. validator on clean file → valid ---------------------------------

function buildCleanIni(counts: {
  C100: number;
  D110: number;
  D120: number;
  M100: number;
}, totalRecords: number): string {
  const summaries: string[] = [
    serializeIniSummary({ recordCode: "A100", totalRecords: "1" }),
  ];
  if (counts.C100 > 0)
    summaries.push(serializeIniSummary({ recordCode: "C100", totalRecords: String(counts.C100) }));
  if (counts.D110 > 0)
    summaries.push(serializeIniSummary({ recordCode: "D110", totalRecords: String(counts.D110) }));
  if (counts.D120 > 0)
    summaries.push(serializeIniSummary({ recordCode: "D120", totalRecords: String(counts.D120) }));
  if (counts.M100 > 0)
    summaries.push(serializeIniSummary({ recordCode: "M100", totalRecords: String(counts.M100) }));
  summaries.push(serializeIniSummary({ recordCode: "Z900", totalRecords: "1" }));
  return [
    serializeA000(buildA000({ totalRecordsInBkmvdata: String(totalRecords) })),
    ...summaries,
  ].join("\r\n");
}

function buildCleanBkmvdata(): string {
  const a100 = serializeA100({
    recordCode: "A100",
    recordSequence: "1",
    vatNumber: VAT,
    primaryId: PRIMARY,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
  });
  const z900 = serializeZ900({
    recordCode: "Z900",
    recordSequence: "2",
    vatNumber: VAT,
    primaryId: PRIMARY,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
    totalRecords: "2",
  });
  return a100 + "\r\n" + z900;
}

function scenarioValidatorClean() {
  const name = "7. validator on clean file → valid";
  const ini = buildCleanIni({ C100: 0, D110: 0, D120: 0, M100: 0 }, 2);
  const bkmv = buildCleanBkmvdata();
  const result = validateUniformStructureFiles({
    ini: iconv.encode(ini, UNIFORM_STRUCTURE_ENCODING),
    bkmvdata: iconv.encode(bkmv, UNIFORM_STRUCTURE_ENCODING),
  });
  record(
    name,
    result.valid && result.errors.length === 0,
    `errors=${result.errors.length}${result.errors.length ? ": " + result.errors.map((e) => e.rule).join(",") : ""}`,
  );
}

// --- 8. validator on truncated A100 → record_length_mismatch ------------

function scenarioValidatorCorrupted() {
  const name = "8. validator on truncated record → invalid";
  const truncA100 = serializeA100({
    recordCode: "A100",
    recordSequence: "1",
    vatNumber: VAT,
    primaryId: PRIMARY,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
  }).slice(0, -10);
  const z900 = serializeZ900({
    recordCode: "Z900",
    recordSequence: "2",
    vatNumber: VAT,
    primaryId: PRIMARY,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
    totalRecords: "2",
  });
  const ini = buildCleanIni({ C100: 0, D110: 0, D120: 0, M100: 0 }, 2);
  const result = validateUniformStructureFiles({
    ini: iconv.encode(ini, UNIFORM_STRUCTURE_ENCODING),
    bkmvdata: iconv.encode(truncA100 + "\r\n" + z900, UNIFORM_STRUCTURE_ENCODING),
  });
  const hasLengthError = result.errors.some(
    (e) => e.rule === "record_length_mismatch",
  );
  record(name, !result.valid && hasLengthError, `errors=${result.errors.length}`);
}

// --- 9. INI count mismatch detection -------------------------------------

function scenarioCountMismatch() {
  const name = "9. validator — INI summary count mismatch detected";
  const ini = buildCleanIni({ C100: 99, D110: 0, D120: 0, M100: 0 }, 2);
  const bkmv = buildCleanBkmvdata();
  const result = validateUniformStructureFiles({
    ini: iconv.encode(ini, UNIFORM_STRUCTURE_ENCODING),
    bkmvdata: iconv.encode(bkmv, UNIFORM_STRUCTURE_ENCODING),
  });
  const mismatch = result.errors.find((e) => e.rule === "ini_count_mismatch");
  record(name, !!mismatch, mismatch?.message ?? "no mismatch detected");
}

// --- 10. A000 1002 ↔ Z900 1155 reconciliation ---------------------------

function scenarioA000Z900TotalReconciliation() {
  const name = "10. validator — A000 field 1002 must equal Z900 field 1155";
  // Lie in A000 — claim 99 total records, but BKMVDATA has only 2.
  const ini = buildCleanIni({ C100: 0, D110: 0, D120: 0, M100: 0 }, 99);
  const bkmv = buildCleanBkmvdata();
  const result = validateUniformStructureFiles({
    ini: iconv.encode(ini, UNIFORM_STRUCTURE_ENCODING),
    bkmvdata: iconv.encode(bkmv, UNIFORM_STRUCTURE_ENCODING),
  });
  const hit = result.errors.find((e) => e.rule === "a000_z900_total_mismatch");
  record(name, !!hit, hit?.message ?? "no mismatch detected");
}

// --- 11. primaryId cross-record consistency ------------------------------

function scenarioPrimaryIdMismatch() {
  const name = "11. validator — primaryId must match across A000/A100/Z900";
  const a100 = serializeA100({
    recordCode: "A100",
    recordSequence: "1",
    vatNumber: VAT,
    primaryId: PRIMARY,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
  });
  const z900 = serializeZ900({
    recordCode: "Z900",
    recordSequence: "2",
    vatNumber: VAT,
    primaryId: "999999999999999", // different!
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
    totalRecords: "2",
  });
  const ini = buildCleanIni({ C100: 0, D110: 0, D120: 0, M100: 0 }, 2);
  const result = validateUniformStructureFiles({
    ini: iconv.encode(ini, UNIFORM_STRUCTURE_ENCODING),
    bkmvdata: iconv.encode(a100 + "\r\n" + z900, UNIFORM_STRUCTURE_ENCODING),
  });
  const hit = result.errors.find((e) => e.rule === "primary_id_mismatch");
  record(name, !!hit, hit?.message ?? "no mismatch detected");
}

// --- 12. trailing CRLF detection ----------------------------------------

function scenarioTrailingCrlf() {
  const name = "12. validator — trailing CRLF detected";
  const ini = buildCleanIni({ C100: 0, D110: 0, D120: 0, M100: 0 }, 2);
  const bkmv = buildCleanBkmvdata() + "\r\n"; // trailing!
  const result = validateUniformStructureFiles({
    ini: iconv.encode(ini, UNIFORM_STRUCTURE_ENCODING),
    bkmvdata: iconv.encode(bkmv, UNIFORM_STRUCTURE_ENCODING),
  });
  const hit = result.errors.find((e) => e.rule === "no_trailing_crlf");
  record(name, !!hit);
}

// --- 13. signed negative (discount) -------------------------------------

function scenarioSignedNegative() {
  const name = "13. signed numeric — discount line is negative";
  const s = formatSignedNumeric(-1180, 16);
  record(name, s === "-000000000118000" && s.length === 16, s);
}

// --- 14. primaryId generator -------------------------------------------

function scenarioPrimaryIdGenerator() {
  const name = "14. generatePrimaryId — 15 digits, not all zeros, varies";
  const a = generatePrimaryId();
  const b = generatePrimaryId();
  const ok =
    /^\d{15}$/.test(a) &&
    /^\d{15}$/.test(b) &&
    a !== b &&
    a !== "0".repeat(15);
  record(name, ok, `${a} vs ${b}`);
}

async function main() {
  console.log("[verify-uniform-structure] starting…\n");
  const scenarios: Array<[string, () => Promise<void> | void]> = [
    ["formatters", scenarioFormatters],
    ["formatterErrors", scenarioFormatterErrors],
    ["vatChecksum", scenarioVatChecksum],
    ["recordLengths", scenarioRecordLengths],
    ["documentTypeCodes", scenarioDocumentTypeCodes],
    ["systemConstants", scenarioSystemConstants],
    ["validatorClean", scenarioValidatorClean],
    ["validatorCorrupted", scenarioValidatorCorrupted],
    ["countMismatch", scenarioCountMismatch],
    ["a000z900TotalReconciliation", scenarioA000Z900TotalReconciliation],
    ["primaryIdMismatch", scenarioPrimaryIdMismatch],
    ["trailingCrlf", scenarioTrailingCrlf],
    ["signedNegative", scenarioSignedNegative],
    ["primaryIdGenerator", scenarioPrimaryIdGenerator],
  ];
  for (const [label, fn] of scenarios) {
    try {
      await fn();
    } catch (err) {
      record(label, false, err instanceof Error ? err.message : String(err));
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n[verify-uniform-structure] ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-uniform-structure] fatal:", err);
  process.exit(1);
});
