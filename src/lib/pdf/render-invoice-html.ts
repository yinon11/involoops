import type {
  TemplateConfig,
  InvoiceData,
  TemplateDesignId,
} from "@/types/template";
import { coerceDesignId } from "@/types/template";
import {
  getCopyMarker,
  getDocumentHeading,
  getTaxIdLabel,
} from "@/lib/documents/headings";
import type { PaymentEntry } from "@/lib/documents/payments";
import {
  buildBankTransferBlock,
  documentTypeShowsBankDetails,
} from "@/lib/documents/bank-details";
import { renderInvoiceTotalsHtml } from "@/lib/pdf/invoice-totals-html";
import { SANDBOX_DOCUMENT_MARK } from "@/lib/shaam/sandbox";
import { reverseChargeCaption } from "@/lib/documents/reverse-charge-caption";
import {
  NO_ALLOCATION_NOTICE,
  NO_ALLOCATION_REASON,
} from "@/lib/documents/no-allocation-notice";
import { documentWatermarkLabel } from "@/lib/documents/document-watermark";
import { pdfContentHeightMm, pdfMarginCss } from "@/lib/pdf/page-box";

function renderValueDateLine(
  label: string,
  invoice: InvoiceData,
): string {
  if (!invoice.valueDate || invoice.valueDate === invoice.invoiceDate) return "";
  return `<p style="margin:4px 0"><span style="color:#6b7280">${label}:</span> ${esc(invoice.valueDate)}</p>`;
}

export interface PdfSignatureStamp {
  signedAt: Date;
  keyId: string;
  canonicalJsonHashShort: string;
  verifyUrl: string;
  /** base64-encoded PNG of the verifyUrl QR code. */
  qrDataUrl: string;
}

export interface PdfCreditNoteBanner {
  originalFormattedNumber: string;
  originalIssueDate: string;
}

const labels = {
  en: {
    creditInvoice: "CREDIT INVOICE",
    referencing: "Credits tax invoice {number} dated {date}",
    billTo: "Bill To",
    from: "From",
    invoiceNumber: "Document #",
    date: "Issue date",
    valueDate: "Value date",
    dueDate: "Due date",
    description: "Description",
    quantity: "Quantity",
    unitPrice: "Price per unit",
    total: "Amount",
    subtotal: "Subtotal",
    vat: "VAT",
    totalDue: "Total due",
    subtotalIls: "Subtotal (ILS)",
    vatIls: "VAT (ILS)",
    totalDueIls: "Total due (ILS)",
    notes: "Notes",
    signedBy: "Digitally signed by InvoLoops",
    signedAt: "Signed at",
    keyId: "Key ID",
    hash: "Hash",
    verifyCta: "Verify authenticity",
    allocationNumber: "Allocation Number",
    allocationAwaiting: "Awaiting allocation",
    allocationRefused: "Issued without an allocation number",
    allocationRefusedNote: NO_ALLOCATION_NOTICE.en,
    allocationRefusedReason: NO_ALLOCATION_REASON.en,
  },
  he: {
    creditInvoice: "חשבונית זיכוי",
    referencing: "בגין חשבונית מס מספר {number} מתאריך {date}",
    billTo: "לכבוד",
    from: "מאת",
    invoiceNumber: "מספר מסמך",
    date: "תאריך הנפקה",
    valueDate: "תאריך ערך",
    dueDate: "תאריך תשלום",
    description: "תיאור",
    quantity: "כמות",
    unitPrice: "מחיר יחידה",
    total: "סה״כ",
    subtotal: "סכום לפני מע״מ",
    vat: "מע״מ",
    totalDue: "סה״כ לתשלום",
    subtotalIls: "סכום לפני מע״מ (₪)",
    vatIls: "מע״מ (₪)",
    totalDueIls: "סה״כ לתשלום (₪)",
    notes: "הערות",
    signedBy: "חתום דיגיטלית על ידי InvoLoops",
    signedAt: "נחתם ב",
    keyId: "מזהה מפתח",
    hash: "טביעת hash",
    verifyCta: "אימות חשבונית",
    allocationNumber: "מספר הקצאה",
    allocationAwaiting: "ממתין להקצאה",
    allocationRefused: "הופק ללא מספר הקצאה",
    allocationRefusedNote: NO_ALLOCATION_NOTICE.he,
    allocationRefusedReason: NO_ALLOCATION_REASON.he,
  },
} as const;

function fmt(amount: number, currency: string, lang: string) {
  return new Intl.NumberFormat(lang === "he" ? "he-IL" : "en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(s: string | undefined | null): string {
  if (!s) return "";
  return esc(s).replace(/\n/g, "<br/>");
}

function renderClassicHtml(config: TemplateConfig, invoice: InvoiceData): string {
  const lang = invoice.language === "he" ? "he" : "en";
  const t = labels[lang];
  const c = (n: number) => fmt(n, invoice.currency, lang);
  const ac = config.accentColor;
  const heading = getDocumentHeading(invoice.documentType, lang);
  const marker = getCopyMarker(invoice.copyMarker, lang);
  const taxIdLabel = getTaxIdLabel(lang);
  const markerChip = marker
    ? `<span style="border:1px solid ${ac};color:${ac};padding:2px 8px;border-radius:4px;font-size:14px;font-weight:600;margin-inline-start:12px">${esc(marker)}</span>`
    : "";

  const logo = config.logoUrl
    ? `<img src="${esc(config.logoUrl)}" style="max-height:64px;margin-bottom:12px;" />`
    : "";

  const rows = invoice.items
    .map(
      (item, i) => `
    <tr style="background:${i % 2 === 0 ? "#f9fafb" : "#fff"}">
      <td style="padding:8px 16px">${esc(item.description)}</td>
      <td style="padding:8px 16px;text-align:center">${item.quantity}</td>
      <td style="padding:8px 16px;text-align:right">${c(item.unitPrice)}</td>
      <td style="padding:8px 16px;text-align:right">${c(item.total)}</td>
    </tr>`
    )
    .join("");

  const cIls = (n: number) => fmt(n, "ILS", lang);
  const totalsBlock = renderInvoiceTotalsHtml(invoice, config, t, c, cIls, ac);

  const notesBlock = invoice.notes
    ? `<div style="margin-top:32px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;padding:16px;font-size:13px">
        <p style="font-weight:600;color:#374151;margin:0 0 4px">${t.notes}</p>
        <p style="color:#6b7280;margin:0;white-space:pre-line">${nl2br(invoice.notes)}</p>
      </div>`
    : "";

  return `
    ${logo}
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${ac};padding-bottom:24px">
      <h1 style="font-size:28px;font-weight:700;color:${ac};margin:0;display:inline-flex;align-items:baseline">${esc(heading)}${markerChip}</h1>
      <div style="text-align:right;font-size:13px;color:#374151">
        <p style="font-weight:700;color:#111;font-size:15px;margin:0">${esc(config.businessName)}</p>
        ${config.businessTaxId ? `<p style="margin:2px 0"><span style="color:#6b7280">${esc(taxIdLabel)}:</span> <strong style="font-family:monospace">${esc(config.businessTaxId)}</strong></p>` : ""}
        ${config.businessAddress ? `<p style="margin:2px 0;white-space:pre-line">${nl2br(config.businessAddress)}</p>` : ""}
        ${config.businessPhone ? `<p style="margin:2px 0">${esc(config.businessPhone)}</p>` : ""}
        ${config.businessEmail ? `<p style="margin:2px 0">${esc(config.businessEmail)}</p>` : ""}
        ${config.businessWebsite ? `<p style="margin:2px 0">${esc(config.businessWebsite)}</p>` : ""}
      </div>
    </div>

    <div style="margin-top:24px;display:flex;justify-content:space-between;gap:32px">
      <div>
        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin:0 0 4px">${t.billTo}</h3>
        <p style="font-weight:600;margin:0">${esc(invoice.customerName)}</p>
        ${invoice.customerEmail ? `<p style="font-size:13px;color:#6b7280;margin:2px 0">${esc(invoice.customerEmail)}</p>` : ""}
        ${invoice.customerAddress ? `<p style="font-size:13px;color:#6b7280;margin:2px 0;white-space:pre-line">${nl2br(invoice.customerAddress)}</p>` : ""}
        ${invoice.customerTaxId ? `<p style="font-size:13px;color:#6b7280;margin:2px 0">${esc(taxIdLabel)}: ${esc(invoice.customerTaxId)}</p>` : ""}
      </div>
      <div style="text-align:right;font-size:13px">
        <p style="margin:0"><span style="color:#6b7280">${t.invoiceNumber}:</span> <strong>${esc(invoice.invoiceNumber)}</strong></p>
        ${renderAllocationLine(t, invoice.allocationNumber, invoice.issuedWithoutAllocation)}
        <p style="margin:4px 0"><span style="color:#6b7280">${t.date}:</span> ${invoice.invoiceDate}</p>
        ${renderValueDateLine(t.valueDate, invoice)}
        ${invoice.dueDate ? `<p style="margin:4px 0"><span style="color:#6b7280">${t.dueDate}:</span> ${invoice.dueDate}</p>` : ""}
      </div>
    </div>

    <table style="width:100%;margin-top:32px;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:${ac};color:#fff">
          <th style="padding:8px 16px;text-align:start">${t.description}</th>
          <th style="padding:8px 16px;text-align:center">${t.quantity}</th>
          <th style="padding:8px 16px;text-align:right">${t.unitPrice}</th>
          <th style="padding:8px 16px;text-align:right">${t.total}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${totalsBlock}

    ${notesBlock}
    ${renderPaymentBlock(lang, ac, invoice.payments ?? [])}
    ${renderBankDetailsBlock(lang, ac, config, invoice)}
  `;
}

function renderModernHtml(config: TemplateConfig, invoice: InvoiceData): string {
  const lang = invoice.language === "he" ? "he" : "en";
  const t = labels[lang];
  const c = (n: number) => fmt(n, invoice.currency, lang);
  const ac = config.accentColor;
  const heading = getDocumentHeading(invoice.documentType, lang);
  const marker = getCopyMarker(invoice.copyMarker, lang);
  const taxIdLabel = getTaxIdLabel(lang);
  const markerChip = marker
    ? `<span style="border:1px solid ${ac};color:${ac};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;margin-inline-start:8px">${esc(marker)}</span>`
    : "";

  const logo = config.logoUrl
    ? `<img src="${esc(config.logoUrl)}" style="height:56px;width:56px;object-fit:contain;border-radius:8px" />`
    : "";

  const rows = invoice.items
    .map(
      (item) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6">${esc(item.description)}</td>
      <td style="padding:12px 16px;text-align:center;color:#6b7280;border-bottom:1px solid #f3f4f6">${item.quantity}</td>
      <td style="padding:12px 16px;text-align:right;color:#6b7280;border-bottom:1px solid #f3f4f6">${c(item.unitPrice)}</td>
      <td style="padding:12px 16px;text-align:right;font-weight:500;border-bottom:1px solid #f3f4f6">${c(item.total)}</td>
    </tr>`
    )
    .join("");

  const cIls = (n: number) => fmt(n, "ILS", lang);
  const totalsBlock = renderInvoiceTotalsHtml(invoice, config, t, c, cIls, ac);

  const notesBlock = invoice.notes
    ? `<div style="margin-top:32px;border-inline-start:4px solid ${ac};padding:8px 0 8px 16px;font-size:13px">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin:0 0 4px">${t.notes}</p>
        <p style="color:#6b7280;margin:0;white-space:pre-line">${nl2br(invoice.notes)}</p>
      </div>`
    : "";

  return `
    <div style="height:8px;background:${ac};border-radius:4px 4px 0 0;width:100%"></div>
    <div style="margin-top:24px;display:flex;justify-content:space-between;align-items:flex-start">
      <div style="display:flex;align-items:center;gap:16px">
        ${logo}
        <div>
          <h2 style="font-size:18px;font-weight:700;margin:0">${esc(config.businessName)}</h2>
          ${config.businessTaxId ? `<p style="font-size:12px;color:#374151;margin:2px 0"><span style="color:#6b7280">${esc(taxIdLabel)}:</span> <strong style="font-family:monospace">${esc(config.businessTaxId)}</strong></p>` : ""}
          ${config.businessEmail ? `<p style="font-size:12px;color:#6b7280;margin:2px 0">${esc(config.businessEmail)}</p>` : ""}
        </div>
      </div>
      <div style="text-align:right">
        <h1 style="font-size:24px;font-weight:900;color:${ac};margin:0;display:inline-flex;align-items:baseline">${esc(heading)}${markerChip}</h1>
        <p style="font-size:13px;font-weight:600;color:#6b7280;margin:4px 0 0">#${esc(invoice.invoiceNumber)}</p>
        ${renderAllocationLine(t, invoice.allocationNumber, invoice.issuedWithoutAllocation)}
      </div>
    </div>

    <div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:32px">
      <div style="background:#f9fafb;border-radius:8px;padding:16px">
        <h3 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${ac};margin:0 0 8px">${t.from}</h3>
        <p style="font-size:14px;font-weight:700;margin:0">${esc(config.businessName)}</p>
        ${config.businessTaxId ? `<p style="font-size:12px;color:#374151;margin:4px 0"><span style="color:#6b7280">${esc(taxIdLabel)}:</span> <strong style="font-family:monospace">${esc(config.businessTaxId)}</strong></p>` : ""}
        ${config.businessAddress ? `<p style="font-size:12px;color:#6b7280;margin:4px 0;white-space:pre-line">${nl2br(config.businessAddress)}</p>` : ""}
        ${config.businessPhone ? `<p style="font-size:12px;color:#6b7280;margin:2px 0">${esc(config.businessPhone)}</p>` : ""}
        ${config.businessWebsite ? `<p style="font-size:12px;color:#6b7280;margin:2px 0">${esc(config.businessWebsite)}</p>` : ""}
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:16px">
        <h3 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${ac};margin:0 0 8px">${t.billTo}</h3>
        <p style="font-size:13px;font-weight:600;margin:0">${esc(invoice.customerName)}</p>
        ${invoice.customerEmail ? `<p style="font-size:12px;color:#6b7280;margin:4px 0">${esc(invoice.customerEmail)}</p>` : ""}
        ${invoice.customerAddress ? `<p style="font-size:12px;color:#6b7280;margin:2px 0;white-space:pre-line">${nl2br(invoice.customerAddress)}</p>` : ""}
        ${invoice.customerTaxId ? `<p style="font-size:12px;color:#6b7280;margin:2px 0">${esc(taxIdLabel)}: ${esc(invoice.customerTaxId)}</p>` : ""}
      </div>
    </div>

    <div style="margin-top:24px;display:flex;gap:24px;font-size:13px">
      <div style="background:${ac}10;border-radius:6px;padding:8px 16px">
        <span style="font-size:12px;color:#6b7280">${t.date}</span>
        <p style="font-weight:600;margin:2px 0 0">${invoice.invoiceDate}</p>
      </div>
      ${renderValueDateLine(t.valueDate, invoice)}
      ${invoice.dueDate ? `<div style="background:${ac}10;border-radius:6px;padding:8px 16px">
        <span style="font-size:12px;color:#6b7280">${t.dueDate}</span>
        <p style="font-weight:600;margin:2px 0 0">${invoice.dueDate}</p>
      </div>` : ""}
    </div>

    <div style="margin-top:32px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb">
            <th style="padding:12px 16px;text-align:start;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280">${t.description}</th>
            <th style="padding:12px 16px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280">${t.quantity}</th>
            <th style="padding:12px 16px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280">${t.unitPrice}</th>
            <th style="padding:12px 16px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280">${t.total}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    ${totalsBlock}

    ${notesBlock}
    ${renderPaymentBlock(lang, ac, invoice.payments ?? [])}
    ${renderBankDetailsBlock(lang, ac, config, invoice)}
  `;
}

function renderSignatureFooter(
  t: (typeof labels)[keyof typeof labels],
  signature: PdfSignatureStamp,
): string {
  const stamp = signature.signedAt
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  // Same size as before (11px type, 96px QR). The 48px padding is the
  // original gap above the rule. `#invoice-signature { margin-top: auto }`
  // only adds the extra space that pins this block to the page bottom.
  return `
    <div id="invoice-signature">
      <div style="border-top:1px solid #e5e7eb;padding-top:16px;display:flex;align-items:flex-start;justify-content:space-between;gap:24px;font-size:11px;color:#374151">
        <div>
          <p style="margin:0;font-weight:600">${t.signedBy}</p>
          <p style="margin:4px 0 0">${t.signedAt}: <span style="font-family:monospace">${stamp} UTC</span></p>
          <p style="margin:2px 0 0">${t.keyId}: <span style="font-family:monospace">${esc(signature.keyId)}</span></p>
          <p style="margin:2px 0 0">${t.hash}: <span style="font-family:monospace">${esc(signature.canonicalJsonHashShort)}…</span></p>
          <p style="margin:6px 0 0">${t.verifyCta}: <span style="font-family:monospace">${esc(signature.verifyUrl)}</span></p>
        </div>
        <img src="${signature.qrDataUrl}" alt="verification QR code" style="width:96px;height:96px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;padding:4px" />
      </div>
    </div>
  `;
}

/** Same split/emphasis rules as on-screen `AllocationNumberLine`. */
function renderAllocationLine(
  t: (typeof labels)[keyof typeof labels],
  allocationNumber: string | null | undefined,
  issuedWithoutAllocation?: boolean,
): string {
  // An explicit "no number was allocated" is not the same as the silence
  // of a below-threshold invoice, so it gets its own line rather than an
  // empty space where the number would have been.
  if (!allocationNumber?.trim() && issuedWithoutAllocation) {
    return `<p style="margin:4px 0;font-size:13px">
      <span style="color:#6b7280">${t.allocationNumber}:</span>
      <strong style="color:#b45309">${t.allocationRefused}</strong>
    </p>`;
  }
  if (!allocationNumber?.trim()) return "";
  const trimmed = allocationNumber.trim();
  const mono = "font-family:monospace;font-size:14px";
  if (trimmed.length <= 9) {
    return `<p style="margin:4px 0;font-size:13px">
      <span style="color:#6b7280">${t.allocationNumber}:</span>
      <strong style="${mono};font-weight:700">${esc(trimmed)}</strong>
    </p>`;
  }
  const prefix = trimmed.slice(0, trimmed.length - 9);
  const last9 = trimmed.slice(-9);
  return `<p style="margin:4px 0;font-size:13px">
    <span style="color:#6b7280">${t.allocationNumber}:</span>
    <span style="${mono}">${esc(prefix)}</span><strong style="${mono};font-weight:700">${esc(last9)}</strong>
  </p>`;
}

/**
 * Spelled out in the body, not just as a missing field. The buyer's
 * accountant needs to see why no input VAT can be deducted, and a blank
 * space where an allocation number usually sits does not say that.
 * Printed by the wrapper, like the reverse-charge caption, so every
 * design carries it.
 */
function renderNoAllocationNotice(
  t: (typeof labels)[keyof typeof labels],
  issuedWithoutAllocation: boolean | undefined,
): string {
  if (!issuedWithoutAllocation) return "";
  const rtl = t.allocationRefusedNote === NO_ALLOCATION_NOTICE.he;
  return `<div style="margin-top:16px;padding:10px 14px;border:2px solid #b45309;background:#fffbeb;border-radius:6px;font-size:13px;color:#78350f;direction:${rtl ? "rtl" : "ltr"};text-align:${rtl ? "right" : "left"}">
    <strong style="font-size:14px">${t.allocationRefusedNote}</strong>
    <div style="margin-top:4px;font-size:12px;font-weight:400">${t.allocationRefusedReason}</div>
  </div>`;
}

function renderCreditNoteBanner(
  t: (typeof labels)[keyof typeof labels],
  banner: PdfCreditNoteBanner,
): string {
  const ref = t.referencing
    .replace("{number}", esc(banner.originalFormattedNumber))
    .replace("{date}", esc(banner.originalIssueDate));
  return `
    <div style="margin-bottom:16px;border:2px solid #dc2626;border-radius:8px;padding:16px;background:#fef2f2">
      <p style="margin:0;font-size:22px;font-weight:900;color:#b91c1c;letter-spacing:2px">${t.creditInvoice}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#7f1d1d">${ref}</p>
    </div>
  `;
}

const paymentBlockLabels = {
  he: {
    title: "פרטי תשלום",
    methodCol: "אמצעי",
    amountCol: "סכום",
    dateCol: "תאריך",
    referenceCol: "אסמכתא",
    total: "סה״כ ששולם",
    method: {
      cash: "מזומן",
      check: "שיק",
      card: "כרטיס אשראי",
      bank_transfer: "העברה בנקאית",
      withholding_tax: "ניכוי מס במקור",
      other: "אחר",
    },
  },
  en: {
    title: "Payment details",
    methodCol: "Method",
    amountCol: "Amount",
    dateCol: "Date",
    referenceCol: "Reference",
    total: "Total paid",
    method: {
      cash: "Cash",
      check: "Check",
      card: "Credit card",
      bank_transfer: "Bank transfer",
      withholding_tax: "Withholding tax",
      other: "Other",
    },
  },
} as const;

/**
 * Bank-transfer details, printed as the last block of the document body so it
 * sits just above the signature / QR footer rather than splitting the totals
 * from the notes. Suppressed on document types that evidence payment already
 * received, so the payment block and this block never both print.
 */
/**
 * Shared chrome for the two footer blocks — bank-transfer details on
 * payment-request documents, payment details on receipts. They are mutually
 * exclusive by document type, so a document shows at most one, and both sit
 * last in the body just above the signature / QR footer.
 *
 * `overflow-wrap:anywhere` is the backstop for a long unbroken value (an IBAN
 * has no spaces to break at) so text can never run past the border.
 */
function renderFooterCard(
  accentColor: string,
  title: string,
  inner: string,
  titleAside = "",
): string {
  return `
    <section style="margin-top:32px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;padding:12px 16px;font-size:12px;line-height:1.8;overflow-wrap:anywhere;break-inside:avoid;page-break-inside:avoid">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
        <span style="font-weight:600;color:${accentColor}">${esc(title)}</span>
        ${titleAside}
      </div>
      ${inner}
    </section>
  `;
}

/**
 * Bank-transfer details. Suppressed on document types that evidence payment
 * already received, so the payment block and this block never both print.
 */
function renderBankDetailsBlock(
  lang: "he" | "en",
  accentColor: string,
  config: TemplateConfig,
  invoice: InvoiceData,
): string {
  if (!config.showBankDetails) return "";
  if (!documentTypeShowsBankDetails(invoice.documentType)) return "";
  const block = buildBankTransferBlock(config.bankDetails, lang);
  if (!block) return "";
  // The separator carries real spaces on both sides: without them the whole
  // run is unbreakable and overflows the card.
  const pairs = block.lines
    .map(
      (line) =>
        `<span style="color:#6b7280">${esc(line.label)}:</span> ` +
        `<span style="font-family:monospace;color:#1f2937">${esc(line.value)}</span>`,
    )
    .join(` <span style="color:#d1d5db">&middot;</span> `);
  const note = block.note
    ? `<p style="margin:6px 0 0;color:#6b7280;white-space:pre-line">${nl2br(block.note)}</p>`
    : "";
  return renderFooterCard(
    accentColor,
    block.title,
    `<p style="margin:0;color:#4b5563">${pairs}</p>${note}`,
  );
}

/**
 * Payment details on TAX_INVOICE_RECEIPT / RECEIPT. Same card as the
 * bank-transfer block above, so a receipt and an invoice read alike; one
 * payment collapses to a single line, several keep the table.
 */
function renderPaymentBlock(
  lang: "he" | "en",
  accentColor: string,
  payments: PaymentEntry[],
): string {
  if (!payments || payments.length === 0) return "";
  const L = paymentBlockLabels[lang];
  const currency = payments[0]?.currency ?? "ILS";
  const total = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const methodLabel = (p: PaymentEntry) =>
    (L.method as Record<string, string>)[p.method] ?? p.method;
  const aside = `<span style="font-weight:600;font-family:monospace;color:#1f2937">${fmt(total, currency, lang)}</span>`;

  if (payments.length === 1) {
    const p = payments[0];
    const pairs = [
      [L.methodCol, esc(methodLabel(p))],
      [L.dateCol, esc(p.date)],
      ...(p.reference ? [[L.referenceCol, esc(p.reference)]] : []),
    ]
      .map(
        ([label, value]) =>
          `<span style="color:#6b7280">${label}:</span> ` +
          `<span style="font-family:monospace;color:#1f2937">${value}</span>`,
      )
      .join(` <span style="color:#d1d5db">&middot;</span> `);
    return renderFooterCard(
      accentColor,
      L.title,
      `<p style="margin:0;color:#4b5563">${pairs}</p>`,
      aside,
    );
  }

  const rows = payments
    .map(
      (p) => `<tr>
        <td style="padding:3px 0">${esc(methodLabel(p))}</td>
        <td style="padding:3px 8px;color:#6b7280">${esc(p.date)}</td>
        <td style="padding:3px 8px;font-family:monospace;color:#6b7280">${esc(p.reference ?? "—")}</td>
        <td style="padding:3px 0;text-align:right;font-family:monospace;color:#1f2937">${fmt(Number(p.amount) || 0, p.currency, lang)}</td>
      </tr>`,
    )
    .join("");
  return renderFooterCard(
    accentColor,
    L.title,
    `<table style="width:100%;border-collapse:collapse;color:#4b5563">
      <thead>
        <tr style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af">
          <th style="padding:0 0 2px;text-align:start;font-weight:600">${L.methodCol}</th>
          <th style="padding:0 8px 2px;text-align:start;font-weight:600">${L.dateCol}</th>
          <th style="padding:0 8px 2px;text-align:start;font-weight:600">${L.referenceCol}</th>
          <th style="padding:0 0 2px;text-align:right;font-weight:600">${L.amountCol}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`,
    aside,
  );
}

/**
 * Minimal — extreme whitespace, monochrome with a single accent rule.
 * Matches `MinimalTemplate` in the React preview.
 */
function renderMinimalHtml(config: TemplateConfig, invoice: InvoiceData): string {
  const lang = invoice.language === "he" ? "he" : "en";
  const t = labels[lang];
  const c = (n: number) => fmt(n, invoice.currency, lang);
  const ac = config.accentColor;
  const heading = getDocumentHeading(invoice.documentType, lang);
  const marker = getCopyMarker(invoice.copyMarker, lang);
  const taxIdLabel = getTaxIdLabel(lang);
  const headingLine = `${esc(heading)}${marker ? ` · ${esc(marker)}` : ""}`;

  const logo = config.logoUrl
    ? `<img src="${esc(config.logoUrl)}" style="height:36px;width:auto;object-fit:contain;margin-bottom:16px" />`
    : "";

  const rows = invoice.items
    .map(
      (item) => `
    <tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:12px 16px 12px 0">${esc(item.description)}</td>
      <td style="padding:12px 16px;text-align:center;color:#6b7280">${item.quantity}</td>
      <td style="padding:12px 16px;text-align:right;color:#6b7280">${c(item.unitPrice)}</td>
      <td style="padding:12px 0 12px 16px;text-align:right;font-weight:500">${c(item.total)}</td>
    </tr>`,
    )
    .join("");

  const cIls = (n: number) => fmt(n, "ILS", lang);
  const totalsBlock = renderInvoiceTotalsHtml(invoice, config, t, c, cIls, ac);

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:32px">
      <div>
        ${logo}
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:4px;color:#9ca3af;margin:0">${headingLine}</p>
        <p style="font-family:monospace;font-size:24px;color:#111;margin:4px 0 0">${esc(invoice.invoiceNumber)}</p>
        ${renderAllocationLine(t, invoice.allocationNumber, invoice.issuedWithoutAllocation)}
      </div>
      <div style="text-align:right;font-size:12px;color:#6b7280;line-height:1.6">
        <p style="font-size:13px;font-weight:600;color:#111;margin:0">${esc(config.businessName)}</p>
        ${config.businessTaxId ? `<p style="margin:0"><span style="color:#9ca3af">${esc(taxIdLabel)}:</span> <span style="font-family:monospace">${esc(config.businessTaxId)}</span></p>` : ""}
        ${config.businessAddress ? `<p style="margin:0;white-space:pre-line">${nl2br(config.businessAddress)}</p>` : ""}
        ${config.businessEmail ? `<p style="margin:0">${esc(config.businessEmail)}</p>` : ""}
        ${config.businessPhone ? `<p style="margin:0">${esc(config.businessPhone)}</p>` : ""}
        ${config.businessWebsite ? `<p style="margin:0">${esc(config.businessWebsite)}</p>` : ""}
      </div>
    </div>

    <div style="height:1px;background:${ac};margin-top:40px"></div>

    <div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:48px;font-size:13px">
      <div>
        <p style="font-size:10px;text-transform:uppercase;letter-spacing:4px;color:#9ca3af;margin:0 0 8px">${t.billTo}</p>
        <p style="font-weight:500;margin:0">${esc(invoice.customerName)}</p>
        ${invoice.customerEmail ? `<p style="color:#6b7280;margin:2px 0">${esc(invoice.customerEmail)}</p>` : ""}
        ${invoice.customerAddress ? `<p style="color:#6b7280;margin:2px 0;white-space:pre-line">${nl2br(invoice.customerAddress)}</p>` : ""}
        ${invoice.customerTaxId ? `<p style="color:#6b7280;margin:2px 0">${esc(taxIdLabel)}: ${esc(invoice.customerTaxId)}</p>` : ""}
      </div>
      <div style="text-align:right">
        <p style="font-size:10px;text-transform:uppercase;letter-spacing:4px;color:#9ca3af;margin:0">${t.date}</p>
        <p style="font-weight:500;margin:2px 0 0">${esc(invoice.invoiceDate)}</p>
        ${renderValueDateLine(t.valueDate, invoice)}
        ${invoice.dueDate ? `<p style="font-size:10px;text-transform:uppercase;letter-spacing:4px;color:#9ca3af;margin:12px 0 0">${t.dueDate}</p><p style="font-weight:500;margin:2px 0 0">${esc(invoice.dueDate)}</p>` : ""}
      </div>
    </div>

    <table style="margin-top:48px;width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="border-bottom:1px solid #e5e7eb;text-align:start;font-size:10px;text-transform:uppercase;letter-spacing:4px;color:#9ca3af">
          <th style="padding-bottom:12px;text-align:start;font-weight:400">${t.description}</th>
          <th style="padding-bottom:12px;text-align:center;font-weight:400">${t.quantity}</th>
          <th style="padding-bottom:12px;text-align:right;font-weight:400">${t.unitPrice}</th>
          <th style="padding-bottom:12px;text-align:right;font-weight:400">${t.total}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${totalsBlock}

    ${invoice.notes ? `<div style="margin-top:40px;font-size:13px;color:#6b7280">
      <p style="font-size:10px;text-transform:uppercase;letter-spacing:4px;color:#9ca3af;margin:0 0 4px">${t.notes}</p>
      <p style="margin:0;white-space:pre-line">${nl2br(invoice.notes)}</p>
    </div>` : ""}
    ${renderPaymentBlock(lang, ac, invoice.payments ?? [])}
    ${renderBankDetailsBlock(lang, ac, config, invoice)}
  `;
}

/**
 * Bold — high-contrast accent header with reversed-out title block.
 * Matches `BoldTemplate` in the React preview.
 */
function renderBoldHtml(config: TemplateConfig, invoice: InvoiceData): string {
  const lang = invoice.language === "he" ? "he" : "en";
  const t = labels[lang];
  const c = (n: number) => fmt(n, invoice.currency, lang);
  const ac = config.accentColor;
  const heading = getDocumentHeading(invoice.documentType, lang);
  const marker = getCopyMarker(invoice.copyMarker, lang);
  const taxIdLabel = getTaxIdLabel(lang);
  const headingLine = `${esc(heading)}${marker ? ` · ${esc(marker)}` : ""}`;

  const logo = config.logoUrl
    ? `<img src="${esc(config.logoUrl)}" style="height:48px;width:48px;object-fit:contain;background:rgba(255,255,255,0.1);border-radius:4px;padding:4px" />`
    : "";

  const rows = invoice.items
    .map(
      (item, i) => `
    <tr style="background:${i % 2 === 0 ? "#f3f4f6" : "#fff"}">
      <td style="padding:12px 16px;font-weight:500">${esc(item.description)}</td>
      <td style="padding:12px 16px;text-align:center">${item.quantity}</td>
      <td style="padding:12px 16px;text-align:right">${c(item.unitPrice)}</td>
      <td style="padding:12px 16px;text-align:right;font-weight:700">${c(item.total)}</td>
    </tr>`,
    )
    .join("");

  const cIls = (n: number) => fmt(n, "ILS", lang);
  const totalsBlock = renderInvoiceTotalsHtml(invoice, config, t, c, cIls, ac);

  return `
    <div style="margin:-32px -32px 0;padding:32px;background:${ac};color:#fff">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">
        <div>
          <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:5px;color:rgba(255,255,255,0.7);margin:0">${headingLine}</p>
          <h1 style="font-family:monospace;font-size:32px;font-weight:900;margin:8px 0 0;letter-spacing:-1px">${esc(invoice.invoiceNumber)}</h1>
          ${renderAllocationLine(t, invoice.allocationNumber, invoice.issuedWithoutAllocation)}
        </div>
        <div style="display:flex;align-items:center;gap:16px;text-align:right">
          ${logo}
          <div>
            <p style="font-size:15px;font-weight:700;margin:0">${esc(config.businessName)}</p>
            ${config.businessTaxId ? `<p style="font-size:11px;margin:2px 0;color:rgba(255,255,255,0.8)"><span style="color:rgba(255,255,255,0.6)">${esc(taxIdLabel)}:</span> <span style="font-family:monospace">${esc(config.businessTaxId)}</span></p>` : ""}
            ${config.businessEmail ? `<p style="font-size:11px;margin:2px 0;color:rgba(255,255,255,0.7)">${esc(config.businessEmail)}</p>` : ""}
            ${config.businessWebsite ? `<p style="font-size:11px;margin:2px 0;color:rgba(255,255,255,0.7)">${esc(config.businessWebsite)}</p>` : ""}
          </div>
        </div>
      </div>
    </div>

    <div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;font-size:13px">
      <div>
        <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:3px;color:#9ca3af;margin:0">${t.billTo}</p>
        <p style="font-weight:700;margin:4px 0 0">${esc(invoice.customerName)}</p>
        ${invoice.customerEmail ? `<p style="font-size:12px;color:#6b7280;margin:2px 0">${esc(invoice.customerEmail)}</p>` : ""}
        ${invoice.customerAddress ? `<p style="font-size:12px;color:#6b7280;margin:2px 0;white-space:pre-line">${nl2br(invoice.customerAddress)}</p>` : ""}
        ${invoice.customerTaxId ? `<p style="font-size:12px;color:#6b7280;margin:2px 0">${esc(taxIdLabel)}: ${esc(invoice.customerTaxId)}</p>` : ""}
      </div>
      <div>
        <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:3px;color:#9ca3af;margin:0">${t.date}</p>
        <p style="font-weight:700;margin:4px 0 0">${esc(invoice.invoiceDate)}</p>
        ${renderValueDateLine(t.valueDate, invoice)}
      </div>
      <div>
        ${invoice.dueDate ? `<p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:3px;color:#9ca3af;margin:0">${t.dueDate}</p><p style="font-weight:700;margin:4px 0 0">${esc(invoice.dueDate)}</p>` : ""}
      </div>
    </div>

    <table style="width:100%;margin-top:40px;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:${ac};color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:3px">
          <th style="padding:12px 16px;text-align:start">${t.description}</th>
          <th style="padding:12px 16px;text-align:center">${t.quantity}</th>
          <th style="padding:12px 16px;text-align:right">${t.unitPrice}</th>
          <th style="padding:12px 16px;text-align:right">${t.total}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${totalsBlock}

    ${invoice.notes ? `<div style="margin-top:40px;border-inline-start:4px solid ${ac};background:#f3f4f6;padding:16px;font-size:13px">
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:3px;color:#6b7280;margin:0">${t.notes}</p>
      <p style="margin:4px 0 0;color:#374151;white-space:pre-line">${nl2br(invoice.notes)}</p>
    </div>` : ""}
    ${renderPaymentBlock(lang, ac, invoice.payments ?? [])}
    ${renderBankDetailsBlock(lang, ac, config, invoice)}
  `;
}

/**
 * Compact — dense single-page layout with smaller type, suited for
 * invoices with many line items. Matches `CompactTemplate`.
 */
function renderCompactHtml(config: TemplateConfig, invoice: InvoiceData): string {
  const lang = invoice.language === "he" ? "he" : "en";
  const t = labels[lang];
  const c = (n: number) => fmt(n, invoice.currency, lang);
  const ac = config.accentColor;
  const heading = getDocumentHeading(invoice.documentType, lang);
  const marker = getCopyMarker(invoice.copyMarker, lang);
  const taxIdLabel = getTaxIdLabel(lang);
  const headingLine = `${esc(heading)}${marker ? ` · ${esc(marker)}` : ""}`;

  const logo = config.logoUrl
    ? `<img src="${esc(config.logoUrl)}" style="height:36px;width:36px;object-fit:contain" />`
    : "";

  const rows = invoice.items
    .map(
      (item) => `
    <tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:4px 8px">${esc(item.description)}</td>
      <td style="padding:4px 8px;text-align:center;color:#4b5563">${item.quantity}</td>
      <td style="padding:4px 8px;text-align:right;color:#4b5563">${c(item.unitPrice)}</td>
      <td style="padding:4px 8px;text-align:right;font-weight:500">${c(item.total)}</td>
    </tr>`,
    )
    .join("");

  const cIls = (n: number) => fmt(n, "ILS", lang);
  const totalsBlock = renderInvoiceTotalsHtml(invoice, config, t, c, cIls, ac);

  const contactLine = [
    config.businessEmail,
    config.businessPhone,
    config.businessWebsite,
  ]
    .filter(Boolean)
    .join(" · ");

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid ${ac};padding-bottom:12px;font-size:12px">
      <div style="display:flex;align-items:center;gap:12px">
        ${logo}
        <div>
          <p style="font-size:15px;font-weight:700;color:${ac};margin:0">${headingLine}</p>
          <p style="font-family:monospace;font-size:13px;font-weight:600;margin:2px 0 0">#${esc(invoice.invoiceNumber)}</p>
          ${renderAllocationLine(t, invoice.allocationNumber, invoice.issuedWithoutAllocation)}
        </div>
      </div>
      <div style="text-align:right;line-height:1.45">
        <p style="font-weight:600;margin:0">${esc(config.businessName)}</p>
        ${config.businessTaxId ? `<p style="color:#4b5563;margin:0">${esc(taxIdLabel)}: <span style="font-family:monospace">${esc(config.businessTaxId)}</span></p>` : ""}
        ${config.businessAddress ? `<p style="color:#4b5563;margin:0;white-space:pre-line">${nl2br(config.businessAddress)}</p>` : ""}
        ${contactLine ? `<p style="color:#4b5563;margin:0">${esc(contactLine)}</p>` : ""}
      </div>
    </div>

    <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;font-size:12px">
      <div>
        <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin:0">${t.billTo}</p>
        <p style="font-weight:600;margin:0">${esc(invoice.customerName)}</p>
        ${invoice.customerTaxId ? `<p style="color:#4b5563;margin:0">${esc(taxIdLabel)}: ${esc(invoice.customerTaxId)}</p>` : ""}
        ${invoice.customerAddress ? `<p style="color:#4b5563;margin:0;white-space:pre-line">${nl2br(invoice.customerAddress)}</p>` : ""}
        ${invoice.customerEmail ? `<p style="color:#4b5563;margin:0">${esc(invoice.customerEmail)}</p>` : ""}
      </div>
      <div>
        <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin:0">${t.date}</p>
        <p style="font-weight:600;margin:0">${esc(invoice.invoiceDate)}</p>
        ${renderValueDateLine(t.valueDate, invoice)}
      </div>
      <div>
        ${invoice.dueDate ? `<p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin:0">${t.dueDate}</p><p style="font-weight:600;margin:0">${esc(invoice.dueDate)}</p>` : ""}
      </div>
    </div>

    <table style="width:100%;margin-top:16px;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="border-top:1px solid #d1d5db;border-bottom:1px solid #d1d5db;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280">
          <th style="padding:4px 8px;text-align:start;font-weight:600">${t.description}</th>
          <th style="padding:4px 8px;text-align:center;font-weight:600">${t.quantity}</th>
          <th style="padding:4px 8px;text-align:right;font-weight:600">${t.unitPrice}</th>
          <th style="padding:4px 8px;text-align:right;font-weight:600">${t.total}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${totalsBlock}

    ${invoice.notes ? `<div style="margin-top:16px;border-top:1px solid #e5e7eb;padding-top:8px;font-size:12px;color:#4b5563">
      <strong style="color:#374151">${t.notes}:</strong> <span style="white-space:pre-line">${nl2br(invoice.notes)}</span>
    </div>` : ""}
    ${renderPaymentBlock(lang, ac, invoice.payments ?? [])}
    ${renderBankDetailsBlock(lang, ac, config, invoice)}
  `;
}

const HTML_RENDERERS: Record<
  TemplateDesignId,
  (config: TemplateConfig, invoice: InvoiceData) => string
> = {
  classic: renderClassicHtml,
  modern: renderModernHtml,
  minimal: renderMinimalHtml,
  bold: renderBoldHtml,
  compact: renderCompactHtml,
};

function renderSandboxBanner(): string {
  return `
    <div style="margin-bottom:16px;border:3px solid #b45309;border-radius:8px;padding:12px 16px;background:#fffbeb">
      <p style="margin:0;font-size:16px;font-weight:900;letter-spacing:0.5px;color:#92400e">${esc(SANDBOX_DOCUMENT_MARK)}</p>
    </div>
  `;
}

/**
 * Diagonal full-page watermark. Used for DRAFT and for CANCELLED.
 * An issued download serves the file stored at issue. A voided download
 * still draws a marked copy for that response and does not replace the
 * stored original, so a seller cannot hand a buyer a clean invoice.
 *
 * `fontSize` shrinks for longer words so the text still fits the page
 * without wrapping; the Hebrew labels are short, the English ones are
 * not.
 */
function renderWatermark(text: string): string {
  const fontSize = text.length > 6 ? 120 : 180;
  const letterSpacing = text.length > 6 ? 12 : 24;
  return `
    <div aria-hidden="true" style="
      position:fixed;
      inset:0;
      display:flex;
      align-items:center;
      justify-content:center;
      pointer-events:none;
      z-index:9999;
    ">
      <span style="
        transform:rotate(-30deg);
        font-size:${fontSize}px;
        font-weight:900;
        color:rgba(239,68,68,0.15);
        letter-spacing:${letterSpacing}px;
        white-space:nowrap;
      ">${esc(text)}</span>
    </div>
  `;
}

export function renderInvoiceHtml(
  config: TemplateConfig,
  invoice: InvoiceData,
  options: {
    isDraft?: boolean;
    /** Voided/cancelled document — overrides the draft watermark. */
    isVoided?: boolean;
    signature?: PdfSignatureStamp;
    creditNote?: PdfCreditNoteBanner;
  } = {},
): string {
  const lang = invoice.language === "he" ? "he" : "en";
  const dir = lang === "he" ? "rtl" : "ltr";
  const t = labels[lang];
  const renderer = HTML_RENDERERS[coerceDesignId(config.designId)];
  const body = renderer(config, invoice);
  const sandboxBanner = invoice.sandbox ? renderSandboxBanner() : "";
  const creditBanner = options.creditNote
    ? renderCreditNoteBanner(t, options.creditNote)
    : "";
  const signatureBlock = options.signature
    ? renderSignatureFooter(t, options.signature)
    : "";
  // Printed by the wrapper rather than per design, so no design can drop it.
  const reverseChargeBlock = invoice.reverseCharge
    ? `<div style="margin-top:16px;padding:10px 14px;border:2px solid #1f2937;border-radius:6px;font-size:13px;font-weight:700;color:#111827;direction:${dir};text-align:${dir === "rtl" ? "right" : "left"}">${esc(reverseChargeCaption(lang))}</div>`
    : "";

  const noAllocationBlock = renderNoAllocationNotice(t, invoice.issuedWithoutAllocation);

  // Voided wins over draft: a document cancelled after a SHAAM refusal
  // leaves `status = "voided"`, at which point `isDraft` goes false and
  // the document would otherwise render with no marking at all.
  const watermark = options.isVoided
    ? renderWatermark(documentWatermarkLabel(lang, "voided"))
    : options.isDraft
      ? renderWatermark(documentWatermarkLabel(lang, "draft"))
      : "";

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ${lang === "he" ? "'Heebo', " : ""}system-ui, -apple-system, sans-serif;
      color: #1f2937;
      font-size: 14px;
      line-height: 1.5;
      position: relative;
    }
    /* The print margins live on the PDF page, so they repeat at the top
       of every page. This box is only the area inside those margins.
       A short signed invoice still fills that area so the signature can
       sit on the bottom edge. */
    #invoice-sheet {
      min-height: ${options.signature ? `${pdfContentHeightMm()}mm` : "auto"};
      display: flex;
      flex-direction: column;
    }
    #invoice-signature {
      margin-top: auto;
      padding-top: 48px;
    }
    table { border-collapse: collapse; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    @page {
      size: A4;
      margin: ${pdfMarginCss("top")} ${pdfMarginCss("right")} ${pdfMarginCss("bottom")} ${pdfMarginCss("left")};
    }
  </style>
</head>
<body>${watermark}<div id="invoice-sheet">${sandboxBanner}${creditBanner}${body}${noAllocationBlock}${reverseChargeBlock}${signatureBlock}</div></body>
</html>`;
}
