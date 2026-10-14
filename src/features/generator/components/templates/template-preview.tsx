"use client";

import { reverseChargeCaption } from "@/lib/documents/reverse-charge-caption";
import {
  noAllocationNotice,
  noAllocationReason,
} from "@/lib/documents/no-allocation-notice";
import type {
  TemplateConfig,
  InvoiceData,
  TemplateDesignId,
  TemplateRendererProps,
} from "@/types/template";
import { coerceDesignId } from "@/types/template";
import { ClassicTemplate } from "./renderers/classic-template";
import { ModernTemplate } from "./renderers/modern-template";
import { MinimalTemplate } from "./renderers/minimal-template";
import { BoldTemplate } from "./renderers/bold-template";
import { CompactTemplate } from "./renderers/compact-template";
import { SANDBOX_DOCUMENT_MARK } from "@/lib/shaam/sandbox";
import {
  documentWatermarkLabel,
  type DocumentWatermark,
} from "@/lib/documents/document-watermark";

interface PreviewSignature {
  signedAt: Date;
  keyId: string;
  canonicalJsonHashShort: string;
  verifyUrl: string;
  qrDataUrl: string;
}

interface TemplatePreviewProps {
  config: TemplateConfig;
  invoice: InvoiceData;
  className?: string;
  /**
   * When the document has been issued + signed, render the same
   * signature footer the PDF carries (signed-at, key id, canonical
   * hash short, verify URL + QR). Omitted on drafts so the preview
   * mirrors the PDF state — drafts get the watermark, not the footer.
   */
  signature?: PreviewSignature | null;
  /**
   * Same diagonal mark the PDF download prints: DRAFT while unissued,
   * CANCELLED once voided (including a cancellation after an ITA refusal).
   */
  watermark?: DocumentWatermark | null;
}

function PreviewWatermark({
  text,
  language,
}: {
  text: string;
  language: "he" | "en";
}) {
  const long = text.length > 6;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
    >
      <span
        style={{
          transform: "rotate(-30deg)",
          fontSize: long ? 120 : 180,
          fontWeight: 900,
          color: "rgba(239,68,68,0.15)",
          letterSpacing: long ? 12 : 24,
          whiteSpace: "nowrap",
          fontFamily: language === "he" ? "'Heebo', sans-serif" : undefined,
        }}
      >
        {text}
      </span>
    </div>
  );
}

const RENDERERS: Record<
  TemplateDesignId,
  (props: TemplateRendererProps) => React.ReactElement
> = {
  classic: ClassicTemplate,
  modern: ModernTemplate,
  minimal: MinimalTemplate,
  bold: BoldTemplate,
  compact: CompactTemplate,
};

export function TemplatePreview({
  config,
  invoice,
  className,
  signature,
  watermark = null,
}: TemplatePreviewProps) {
  const Renderer = RENDERERS[coerceDesignId(config.designId)];
  const lang = invoice.language === "he" ? "he" : "en";
  const dir = lang === "he" ? "rtl" : "ltr";
  const labels =
    lang === "he"
      ? {
          signedBy: "חתום דיגיטלית על ידי InvoLoops",
          signedAt: "נחתם ב",
          keyId: "מזהה מפתח",
          hash: "טביעת hash",
          verifyCta: "אימות חשבונית",
          qrAlt: "קוד QR לאימות",
        }
      : {
          signedBy: "Digitally signed by InvoLoops",
          signedAt: "Signed at",
          keyId: "Key ID",
          hash: "Hash",
          verifyCta: "Verify authenticity",
          qrAlt: "verification QR code",
        };

  return (
    <div
      className={`overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm ${className ?? ""}`}
    >
      <div
        dir={dir}
        className={`relative flex flex-col p-4 sm:p-8 ${signature ? "min-h-[297mm]" : ""}`}
      >
        {watermark && (
          <PreviewWatermark
            text={documentWatermarkLabel(lang, watermark)}
            language={lang}
          />
        )}
        {invoice.sandbox && (
          <div className="mb-4 rounded-md border-2 border-amber-700 bg-amber-50 px-4 py-3 text-sm font-bold tracking-wide text-amber-900">
            {SANDBOX_DOCUMENT_MARK}
          </div>
        )}
        <Renderer config={config} invoice={invoice} />
        {invoice.issuedWithoutAllocation && (
          <div className="mt-4 rounded-md border-2 border-amber-700 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <p className="font-bold">{noAllocationNotice(invoice.language)}</p>
            <p className="mt-1 text-xs">{noAllocationReason(invoice.language)}</p>
          </div>
        )}
        {invoice.reverseCharge && (
          <div className="mt-4 rounded-md border-2 border-gray-800 px-4 py-2.5 text-sm font-bold text-gray-900">
            {reverseChargeCaption(invoice.language)}
          </div>
        )}
        {signature && (
          <div className="mt-auto pt-12">
            <div className="flex flex-wrap items-start justify-between gap-6 border-t border-gray-200 pt-4 text-[11px] text-gray-700">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-semibold">{labels.signedBy}</p>
                <p>
                  {labels.signedAt}:{" "}
                  <span className="font-mono break-all">
                    {signature.signedAt
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 19)}{" "}
                    UTC
                  </span>
                </p>
                <p>
                  {labels.keyId}:{" "}
                  <span className="font-mono break-all">{signature.keyId}</span>
                </p>
                <p>
                  {labels.hash}:{" "}
                  <span className="font-mono break-all">
                    {signature.canonicalJsonHashShort}…
                  </span>
                </p>
                <p className="pt-1.5">
                  {labels.verifyCta}:{" "}
                  <a
                    href={signature.verifyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono break-all text-indigo-700 underline"
                  >
                    {signature.verifyUrl}
                  </a>
                </p>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signature.qrDataUrl}
                alt={labels.qrAlt}
                className="h-24 w-24 shrink-0 rounded border border-gray-200 bg-white p-1"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const sampleInvoice: InvoiceData = {
  invoiceNumber: "0001",
  invoiceDate: "2026-04-16",
  dueDate: "2026-05-16",
  customerName: "ישראל ישראלי",
  customerEmail: "israel@example.com",
  customerAddress: "רחוב הרצל 1\nתל אביב",
  customerTaxId: "123456789",
  items: [
    { description: "שירותי ייעוץ", quantity: 10, unitPrice: 350, total: 3500 },
    { description: "פיתוח אתר", quantity: 1, unitPrice: 8000, total: 8000 },
    { description: "עיצוב גרפי", quantity: 3, unitPrice: 500, total: 1500 },
  ],
  subtotal: 13000,
  vatRate: 18,
  vatAmount: 2340,
  total: 15340,
  currency: "ILS",
  language: "he",
  notes: "תודה על שיתוף הפעולה!",
};
