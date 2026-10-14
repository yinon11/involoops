/**
 * Generate Appendix 4 §5.4 completion report (PDF) from INI.TXT.
 *
 *   npx tsx scripts/generate-appendix-54-print.ts
 *
 * Output:
 *   docs/ita-compliance/form-513-submission/prints/appendix-4/appendix-54-report.pdf
 */

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";
import {
  buildAppendix54ReportFromIni,
  renderAppendix54ReportHtml,
} from "../src/lib/uniform-structure/appendix-54-report";

const DEFAULT_INI = path.join(
  process.cwd(),
  "docs/ita-compliance/form-513-submission/uniform-structure/export/INI.TXT",
);

const OUT_DIR = path.join(
  process.cwd(),
  "docs/ita-compliance/form-513-submission/prints/appendix-4",
);

async function main() {
  const iniPath =
    process.env.UNIFORM_INI_PATH?.trim() ||
    process.argv.find((a) => a.startsWith("--ini="))?.split("=", 2)[1] ||
    DEFAULT_INI;

  const report = await buildAppendix54ReportFromIni({ iniPath });
  const html = renderAppendix54ReportHtml(report);
  await mkdir(OUT_DIR, { recursive: true });

  const htmlPath = path.join(OUT_DIR, "appendix-54-report.html");
  const pdfPath = path.join(OUT_DIR, "appendix-54-report.pdf");
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
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
  } finally {
    await browser.close();
  }

  console.log("Appendix 4 §5.4 report written:");
  console.log("  PDF:", pdfPath);
  console.log("  HTML:", htmlPath);
  console.log("  INI:", iniPath);
  for (const r of report.recordRows) {
    console.log(`    ${r.code} ${r.labelHe}: ${r.count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
