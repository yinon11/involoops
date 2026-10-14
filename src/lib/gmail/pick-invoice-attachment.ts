/**
 * When an email arrives with multiple attachments, pick the one most likely
 * to be the actual invoice. Vendor emails commonly bundle the main invoice
 * alongside non-invoice files: payment receipts, usage detail spreadsheets,
 * letterheads, logo images, terms PDFs, etc.
 *
 * Strategy: score each attachment by filename signals and file type, then
 * return only the single best non-ZIP candidate. ZIP files are always kept
 * because they are batch containers handled internally by processZipArchive.
 *
 * A single attachment passes through unchanged (no scoring needed).
 */

import type { AttachmentRef } from "./attachments";

/** Filename substrings that strongly indicate the file IS an invoice. */
const INVOICE_SIGNALS: string[] = [
  "invoice",
  "inv-",
  "inv_",
  "factura",
  "חשבונית",
  "rechnung",
  "facture",
  "fattura",
  "فاتورة",
  "请求书",
  "청구서",
];

/**
 * Filename substrings that indicate the file is NOT the primary invoice
 * (receipt = payment confirmation, usage/detail = line-item breakdown, etc.).
 */
const NON_INVOICE_SIGNALS: string[] = [
  "receipt",
  "usage",
  "detail",
  "summary",
  "statement",
  "report",
  "terms",
  "logo",
  "signature",
  "letterhead",
  "appendix",
  "exhibit",
  "schedule",
];

function scoreAttachment(att: AttachmentRef): number {
  const name = att.filename.toLowerCase();
  let score = 0;

  for (const kw of INVOICE_SIGNALS) {
    if (name.includes(kw)) {
      score += 10;
      break;
    }
  }

  for (const kw of NON_INVOICE_SIGNALS) {
    if (name.includes(kw)) {
      score -= 5;
      break;
    }
  }

  // PDFs are more likely to be formal invoices than raw images.
  if (name.endsWith(".pdf")) {
    score += 3;
  }

  // Very small files (< 20 KB) are likely logos, signatures, or icons rather
  // than real invoice documents.
  if (att.size > 0 && att.size < 20 * 1024) {
    score -= 2;
  }

  return score;
}

/**
 * Given the full attachment list for one email, returns the subset that should
 * be processed as invoices.
 *
 * - 0 or 1 attachment → returned as-is.
 * - Multiple attachments → the highest-scoring non-ZIP wins; all others are
 *   silently skipped and logged. ZIP files are always forwarded alongside the
 *   winner because their contents are evaluated later by processZipArchive.
 *
 * The returned array is always non-empty when the input is non-empty.
 */
export function pickInvoiceAttachments(
  attachments: AttachmentRef[],
): AttachmentRef[] {
  if (attachments.length <= 1) return attachments;

  const isZip = (a: AttachmentRef) => /\.zip$/i.test(a.filename);
  const zips = attachments.filter(isZip);
  const nonZips = attachments.filter((a) => !isZip(a));

  if (nonZips.length <= 1) {
    // Either 0 or 1 non-ZIP; nothing to decide.
    return attachments;
  }

  const scored = nonZips
    .map((att) => ({ att, score: scoreAttachment(att) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break 1: PDF over image.
      const aPdf = a.att.filename.toLowerCase().endsWith(".pdf") ? 1 : 0;
      const bPdf = b.att.filename.toLowerCase().endsWith(".pdf") ? 1 : 0;
      if (bPdf !== aPdf) return bPdf - aPdf;
      // Tie-break 2: larger file is more likely the full document.
      return b.att.size - a.att.size;
    });

  const winner = scored[0].att;
  const dropped = scored.slice(1).map((s) => s.att.filename);

  console.log(
    `[gmail.intake] multi-attachment: keeping "${winner.filename}" ` +
      `(score ${scored[0].score}), ignoring: ${dropped.map((f) => `"${f}"`).join(", ")}`,
  );

  return [...zips, winner];
}
