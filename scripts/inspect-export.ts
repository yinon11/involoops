/**
 * One-shot inspector for a generated (INI.TXT, BKMVDATA.TXT) pair.
 * Decodes them as ISO-8859-8, runs the local validator, and prints
 * the structural facts (record counts, A000/A100/Z900 byte slices,
 * primaryId / system-constant placement). Use during Tier 2 review
 * to confirm a real export matches the v1.31 spec without hand-
 * counting bytes.
 *
 *   npx tsx scripts/inspect-export.ts <ini-path> <bkmvdata-path>
 */

import { readFileSync } from "node:fs";
import iconv from "iconv-lite";
import { validateUniformStructureFiles } from "@/lib/uniform-structure/validate";
import {
  UNIFORM_STRUCTURE_ENCODING,
  UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
} from "@/lib/uniform-structure/types";
import { A000_TOTAL_LENGTH } from "@/lib/uniform-structure/records/a000";
import { A100_TOTAL_LENGTH } from "@/lib/uniform-structure/records/a100";
import { Z900_TOTAL_LENGTH } from "@/lib/uniform-structure/records/z900";

const [, , iniPath, bkmvPath] = process.argv;
if (!iniPath || !bkmvPath) {
  console.error("usage: tsx scripts/inspect-export.ts <ini-path> <bkmvdata-path>");
  process.exit(2);
}

const iniBuf = readFileSync(iniPath);
const bkmvBuf = readFileSync(bkmvPath);
const iniText = iconv.decode(iniBuf, UNIFORM_STRUCTURE_ENCODING);
const bkmvText = iconv.decode(bkmvBuf, UNIFORM_STRUCTURE_ENCODING);

console.log("─".repeat(72));
console.log("FILE SIZES");
console.log(`  INI.TXT      : ${iniBuf.length.toString().padStart(7)} bytes`);
console.log(`  BKMVDATA.TXT : ${bkmvBuf.length.toString().padStart(7)} bytes`);

console.log("\n" + "─".repeat(72));
console.log("INI.TXT STRUCTURE");
const iniLines = iniText.split("\r\n");
console.log(`  ${iniLines.length} lines (A000 + ${iniLines.length - 1} summary lines)`);
iniLines.forEach((line, i) => {
  const code = line.slice(0, 4);
  console.log(`  [${(i + 1).toString().padStart(2)}] ${code} (${line.length} chars)${i === 0 ? " ← header" : ""}`);
});

console.log("\n" + "─".repeat(72));
console.log("BKMVDATA.TXT STRUCTURE");
const bkmvLines = bkmvText.split("\r\n");
const counts: Record<string, number> = {};
const lengths: Record<string, Set<number>> = {};
for (const line of bkmvLines) {
  const code = line.slice(0, 4) || "<short>";
  counts[code] = (counts[code] ?? 0) + 1;
  if (!lengths[code]) lengths[code] = new Set();
  lengths[code].add(line.length);
}
console.log(`  ${bkmvLines.length} lines, ${Object.keys(counts).length} record types`);
console.log(`  ${"code".padEnd(6)} ${"count".padStart(6)} ${"len(s)".padStart(10)}`);
for (const [code, n] of Object.entries(counts)) {
  const lens = [...lengths[code]].sort().join(",");
  console.log(`  ${code.padEnd(6)} ${n.toString().padStart(6)} ${lens.padStart(10)}`);
}

console.log("\n" + "─".repeat(72));
console.log("CROSS-RECORD INVARIANTS");
const a000 = iniLines[0];
const a100 = bkmvLines[0];
const z900 = bkmvLines[bkmvLines.length - 1];
if (a000.length !== A000_TOTAL_LENGTH)
  console.log(`  ✗ A000 length ${a000.length} ≠ expected ${A000_TOTAL_LENGTH}`);
if (a100.length !== A100_TOTAL_LENGTH)
  console.log(`  ✗ A100 length ${a100.length} ≠ expected ${A100_TOTAL_LENGTH}`);
if (z900.length !== Z900_TOTAL_LENGTH)
  console.log(`  ✗ Z900 length ${z900.length} ≠ expected ${Z900_TOTAL_LENGTH}`);

const a000Constant = a000.slice(48, 56);
const a100Constant = a100.slice(37, 45);
const z900Constant = z900.slice(37, 45);
const a000PrimaryId = a000.slice(33, 48);
const a100PrimaryId = a100.slice(22, 37);
const z900PrimaryId = z900.slice(22, 37);
const a000Total = a000.slice(9, 24);
const z900Total = z900.slice(45, 60);

console.log(`  systemConstant  A000=${JSON.stringify(a000Constant)} A100=${JSON.stringify(a100Constant)} Z900=${JSON.stringify(z900Constant)}`);
const constantsMatch =
  a000Constant === UNIFORM_STRUCTURE_SYSTEM_CONSTANT &&
  a100Constant === UNIFORM_STRUCTURE_SYSTEM_CONSTANT &&
  z900Constant === UNIFORM_STRUCTURE_SYSTEM_CONSTANT;
console.log(`  → ${constantsMatch ? "✓" : "✗"} all three carry "${UNIFORM_STRUCTURE_SYSTEM_CONSTANT}"`);

console.log(`  primaryId       A000=${a000PrimaryId} A100=${a100PrimaryId} Z900=${z900PrimaryId}`);
const idsMatch =
  a000PrimaryId === a100PrimaryId && a100PrimaryId === z900PrimaryId;
console.log(`  → ${idsMatch ? "✓" : "✗"} all three primaryIds equal`);

console.log(`  totals          A000.field1002=${a000Total} Z900.field1155=${z900Total} actual_lines=${bkmvLines.length}`);
const totalsMatch =
  Number(a000Total) === Number(z900Total) &&
  Number(a000Total) === bkmvLines.length;
console.log(`  → ${totalsMatch ? "✓" : "✗"} reconciled`);

console.log("\n" + "─".repeat(72));
console.log("A000 FIELD DUMP (first 100 chars)");
console.log(`  "${a000.slice(0, 100)}…"`);

console.log("\n" + "─".repeat(72));
console.log("A100 FULL");
console.log(`  "${a100}"`);

console.log("\n" + "─".repeat(72));
console.log("Z900 FULL");
console.log(`  "${z900}"`);

console.log("\n" + "─".repeat(72));
console.log("VALIDATOR REPORT");
const report = validateUniformStructureFiles({
  ini: iniBuf,
  bkmvdata: bkmvBuf,
});
console.log(`  valid: ${report.valid}`);
console.log(`  recordCounts: ${JSON.stringify(report.recordCounts)}`);
console.log(`  errors:   ${report.errors.length}`);
report.errors.forEach((e) => console.log(`    ✗ [${e.recordType}#${e.recordNumber}] ${e.rule}: ${e.message}`));
console.log(`  warnings: ${report.warnings.length}`);
report.warnings.forEach((w) => console.log(`    ! [${w.recordType}#${w.recordNumber}] ${w.rule}: ${w.message}`));

console.log("\n" + "─".repeat(72));
process.exit(report.valid ? 0 : 1);
