import { createHash } from "node:crypto";
import puppeteer from "puppeteer";
import type { TemplateConfig, InvoiceData } from "@/types/template";
import {
  renderInvoiceHtml,
  type PdfSignatureStamp,
  type PdfCreditNoteBanner,
} from "./render-invoice-html";
import { signPdfBuffer } from "@/lib/signing/pdf-sign";
import { isPdfSigningConfigured } from "@/lib/signing/pdf-key-store";
import {
  mmToCssPx,
  pdfContentHeightMm,
  pdfContentWidthMm,
  pdfMarginCss,
} from "@/lib/pdf/page-box";

export interface GeneratedInvoicePdf {
  buffer: Buffer;
  /** Hex-encoded SHA-256 of `buffer`. Consumed by the PDF_GENERATED audit event. */
  sha256: string;
  byteLength: number;
  /** True when a PAdES-B signature was embedded. False for drafts and when the keystore is unconfigured. */
  padesSigned: boolean;
}

export interface GenerateInvoicePdfOptions {
  isDraft?: boolean;
  isVoided?: boolean;
  signature?: PdfSignatureStamp;
  creditNote?: PdfCreditNoteBanner;
}

/**
 * Chromium drops flex `margin-top: auto` when it paginates, which
 * pulls the signature block back up under the totals. Freeze the
 * gap the screen layout already resolved. Does not change the
 * footer's own size or the page margin.
 */
function pinSignatureFooterToPageBottom() {
  const footer = document.getElementById("invoice-signature");
  const sheet = document.getElementById("invoice-sheet");
  if (!footer || !sheet) return;
  // Only lock the gap flex already created inside this page. Adding
  // more pushes a multi-page invoice's block onto a following page.
  const usedMargin = parseFloat(getComputedStyle(footer).marginTop) || 0;
  footer.style.marginTop = `${usedMargin}px`;
  sheet.style.display = "block";
  sheet.style.minHeight = "auto";
}

/** True when the laid-out sheet is taller than one printed page. */
function invoiceSpansPages() {
  const sheet = document.getElementById("invoice-sheet");
  if (!sheet) return false;
  return sheet.scrollHeight > document.documentElement.clientHeight + 2;
}

export async function generateInvoicePdf(
  config: TemplateConfig,
  invoice: InvoiceData,
  options: GenerateInvoicePdfOptions = {},
): Promise<GeneratedInvoicePdf> {
  const html = renderInvoiceHtml(config, invoice, options);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  let unsignedBuffer: Buffer;
  try {
    const page = await browser.newPage();
    // Match the A4 width so the frozen gap is the one print will use.
    await page.setViewport({
      width: mmToCssPx(pdfContentWidthMm()),
      height: mmToCssPx(pdfContentHeightMm()),
      deviceScaleFactor: 1,
    });
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "networkidle0" });
    if (options.signature) {
      await page.evaluate(pinSignatureFooterToPageBottom);
    }
    // A one-page invoice has nothing to number. The label is only
    // useful once a second page exists.
    const spansPages = await page.evaluate(invoiceSpansPages);
    const he = invoice.language === "he";
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: spansPages,
      headerTemplate: "<div></div>",
      footerTemplate: he
        ? `<div style="font-size:10px;font-family:Heebo,'Noto Sans Hebrew',sans-serif;color:#6b7280;width:100%;text-align:center;">עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></div>`
        : `<div style="font-size:10px;font-family:system-ui,sans-serif;color:#6b7280;width:100%;text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
      margin: {
        top: pdfMarginCss("top"),
        right: pdfMarginCss("right"),
        bottom: pdfMarginCss("bottom"),
        left: pdfMarginCss("left"),
      },
    });
    unsignedBuffer = Buffer.from(pdf);
  } finally {
    await browser.close();
  }

  // PAdES-B signing is a pure post-render byte-in/byte-out step: we
  // sign any non-draft PDF when the keystore is configured. Drafts
  // carry the visible DRAFT watermark and are previews, never signed.
  //
  // The `signature` option draws a *visible* footer (signed-at, key id,
  // canonical-hash short, verify URL + QR code). All issued / finalised
  // / sent / credit-note PDFs pass it via `buildPdfSignatureStamp` /
  // `loadPdfSignatureStamp` (see `src/lib/pdf/signature-stamp.ts`) so
  // every customer-facing PDF carries a verifiable footer.
  // Drafts and not-yet-signed renders skip the footer.
  const shouldSign = options.isDraft !== true && isPdfSigningConfigured();
  const buffer = shouldSign ? await signPdfBuffer(unsignedBuffer) : unsignedBuffer;
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    buffer,
    sha256,
    byteLength: buffer.byteLength,
    padesSigned: shouldSign,
  };
}
