/**
 * Generate §2.6(b) printed validation report (PDF) from live DB data.
 *
 *   PERIOD_START=2026-03-28 PERIOD_END=2026-04-27 \
 *     npx tsx scripts/generate-section-26-print.ts
 *
 * Output default:
 *   docs/ita-compliance/form-513-submission/prints/section-2-6/section-26-report.pdf
 */

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";
import { isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { businessEntities } from "../src/db/schema";
import {
  buildSection26Report,
  buildSection26ReportFromExportFiles,
  renderSection26ReportHtml,
} from "../src/lib/uniform-structure/section-26-report";

const DEFAULT_EXPORT_DIR = path.join(
  process.cwd(),
  "docs/ita-compliance/form-513-submission/uniform-structure/export",
);

const OUT_DIR = path.join(
  process.cwd(),
  "docs/ita-compliance/form-513-submission/prints/section-2-6",
);

function parseDateArg(name: string, fallback: string): string {
  const fromEnv = process.env[name]?.trim();
  const flag = `--${name.toLowerCase().replace(/_/g, "-")}=`;
  const fromArgv = process.argv.find((a) => a.startsWith(flag));
  if (fromArgv) return fromArgv.split("=", 2)[1]!;
  return fromEnv ?? fallback;
}

async function resolveBusinessEntityId(): Promise<string> {
  const explicit = process.env.BUSINESS_ENTITY_ID?.trim();
  if (explicit) return explicit;

  const entities = await db
    .select({ id: businessEntities.id, osek: businessEntities.osekMurshe })
    .from(businessEntities)
    .where(isNotNull(businessEntities.osekMurshe));

  if (entities.length === 1) return entities[0]!.id;
  if (entities.length === 0) {
    throw new Error("No business entity with osek_murshe.");
  }
  throw new Error(
    `Multiple entities — set BUSINESS_ENTITY_ID. Found: ${entities.map((e) => `${e.id} (${e.osek})`).join(", ")}`,
  );
}

async function main() {
  const periodStart = parseDateArg("PERIOD_START", "2026-03-28");
  const periodEnd = parseDateArg("PERIOD_END", "2026-04-27");
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T23:59:59Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    console.error("Invalid period:", periodStart, periodEnd);
    process.exit(1);
  }

  const exportDir =
    process.env.UNIFORM_EXPORT_DIR?.trim() ||
    process.argv.find((a) => a.startsWith("--export-dir="))?.split("=", 2)[1] ||
    DEFAULT_EXPORT_DIR;

  const iniPath = path.join(exportDir, "INI.TXT");
  const bkmvPath = path.join(exportDir, "BKMVDATA.TXT");

  let report;
  const useFiles =
    process.argv.includes("--from-export") ||
    process.env.SECTION_26_FROM_EXPORT === "1";

  if (useFiles) {
    report = await buildSection26ReportFromExportFiles({ iniPath, bkmvdataPath: bkmvPath });
  } else {
    try {
      const businessEntityId = await resolveBusinessEntityId();
      report = await buildSection26Report({
        businessEntityId,
        periodStart: start,
        periodEnd: end,
      });
    } catch {
      console.warn("DB unavailable — falling back to export files:", exportDir);
      report = await buildSection26ReportFromExportFiles({
        iniPath,
        bkmvdataPath: bkmvPath,
      });
    }
  }

  const html = renderSection26ReportHtml(report, 1, 1);
  await mkdir(OUT_DIR, { recursive: true });

  const htmlPath = path.join(OUT_DIR, "section-26-report.html");
  const pdfPath = path.join(OUT_DIR, "section-26-report.pdf");
  await writeFile(htmlPath, html, "utf8");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
  } finally {
    await browser.close();
  }

  const active = report.rows.filter((r) => r.quantity > 0);
  console.log("§2.6 report written:");
  console.log("  PDF:", pdfPath);
  console.log("  HTML:", htmlPath);
  console.log("  Taxpayer:", report.taxpayerName, report.taxpayerVat);
  console.log("  Period:", report.periodStart, "→", report.periodEnd);
  console.log("  Document types with activity:", active.length);
  for (const r of active) {
    console.log(`    ${r.code} ${r.labelHe}: qty=${r.quantity} ils=${r.totalIls}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
