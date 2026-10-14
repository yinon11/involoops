/**
 * Run the invoice extraction pipeline on a PDF (same logic as upload / pending).
 *
 * Usage:
 *   npx tsx scripts/extract-invoice-local.ts <path/to.pdf>
 *
 * Requires ANTHROPIC_API_KEY in env (loads `.env` then `.env.local`, override).
 * Optional: EXTRACT_HINTS="..." mimics general extraction notes (default matches handwritten Hebrew + 18% hint).
 */

import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });
import { resolve } from "node:path";

import { processInvoice } from "../src/lib/extraction/pipeline";
import type { VendorRule } from "../src/types/vendor";

const DEFAULT_HINTS =
  "For handwritten Hebrew invoices, if confident is low with the amount, double check yourself with the VAT that should be 18% — this can help you understand the true totals.";

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error(
      "Usage: npx tsx scripts/extract-invoice-local.ts <invoice.pdf>",
    );
    process.exit(1);
  }

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    console.error("Missing ANTHROPIC_API_KEY (set in .env.local or export).");
    process.exit(1);
  }

  const hints = (process.env.EXTRACT_HINTS ?? DEFAULT_HINTS).trim();
  const vendorRules: VendorRule[] = hints
    ? [{ vendorId: null, priority: 0, instructions: hints }]
    : [];

  const abs = resolve(pdfPath);
  const buf = readFileSync(abs);

  console.warn("[extract-local] file=%s bytes=%d hints=%s", abs, buf.length, hints.slice(0, 80) + (hints.length > 80 ? "…" : ""));

  const result = await processInvoice(buf, "local-script-user", [], vendorRules, key);

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
