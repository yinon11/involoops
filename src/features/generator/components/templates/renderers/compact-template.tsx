"use client";

import type { TemplateRendererProps } from "@/types/template";
import {
  getCopyMarker,
  getDocumentHeading,
  getTaxIdLabel,
} from "@/lib/documents/headings";
import { PaymentBlock } from "@/features/generator/components/outbound/payment-block";
import { BankDetailsBlock } from "@/features/generator/components/outbound/bank-details-block";
import { InvoiceTotalsFooter } from "@/features/generator/components/templates/invoice-totals-footer";
import { AllocationNumberLine } from "@/features/generator/components/templates/allocation-number-line";

const labels = {
  en: {
    billTo: "Bill to",
    from: "From",
    invoiceNumber: "Document #",
    date: "Date",
    dueDate: "Due",
    description: "Description",
    quantity: "Quantity",
    unitPrice: "Price per unit",
    total: "Amount",
    subtotal: "Subtotal",
    vat: "VAT",
    totalDue: "Total due",
    notes: "Notes",
  },
  he: {
    billTo: "לכבוד",
    from: "מאת",
    invoiceNumber: "מספר",
    date: "תאריך",
    dueDate: "פרעון",
    description: "תיאור",
    quantity: "כמות",
    unitPrice: "מחיר יחידה",
    total: "סה״כ",
    subtotal: "לפני מע״מ",
    vat: "מע״מ",
    totalDue: "סה״כ לתשלום",
    notes: "הערות",
  },
} as const;

function formatCurrency(amount: number, currency: string, lang: string) {
  return new Intl.NumberFormat(lang === "he" ? "he-IL" : "en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

/**
 * Compact — dense single-page layout for invoices with many line
 * items. Smaller type, tighter padding, no decorative bands; uses the
 * accent only for the totals row and dividers.
 */
export function CompactTemplate({ config, invoice }: TemplateRendererProps) {
  const lang = invoice.language === "he" ? "he" : "en";
  const t = labels[lang];
  const dir = lang === "he" ? "rtl" : "ltr";
  const fmt = (n: number) => formatCurrency(n, invoice.currency, lang);
  const heading = getDocumentHeading(invoice.documentType, lang);
  const marker = getCopyMarker(invoice.copyMarker, lang);
  const taxIdLabel = getTaxIdLabel(lang);

  return (
    <div
      dir={dir}
      className="bg-white text-[12px] leading-snug text-gray-900"
      style={{ fontFamily: lang === "he" ? "'Heebo', sans-serif" : "inherit" }}
    >
      <div
        className="flex items-start justify-between border-b pb-3"
        style={{ borderColor: config.accentColor }}
      >
        <div className="flex items-center gap-3">
          {config.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={config.logoUrl}
              alt=""
              className="h-9 w-9 object-contain"
            />
          )}
          <div>
            <p
              className="text-base font-bold"
              style={{ color: config.accentColor }}
            >
              {heading}
              {marker ? ` · ${marker}` : ""}
            </p>
            <p className="font-mono text-[13px] font-semibold">
              #{invoice.invoiceNumber}
            </p>
            <AllocationNumberLine
              allocationNumber={invoice.allocationNumber}
              lang={lang}
              className="text-[13px]"
            />
          </div>
        </div>
        <div className="text-right">
          <p className="font-semibold">{config.businessName}</p>
          {config.businessTaxId && (
            <p className="text-gray-600">
              {taxIdLabel}:{" "}
              <span className="font-mono">{config.businessTaxId}</span>
            </p>
          )}
          {config.businessAddress && (
            <p className="whitespace-pre-line text-gray-600">
              {config.businessAddress}
            </p>
          )}
          {(config.businessEmail ||
            config.businessPhone ||
            config.businessWebsite) && (
            <p className="text-gray-600">
              {[config.businessEmail, config.businessPhone, config.businessWebsite]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {t.billTo}
          </p>
          <p className="font-semibold">{invoice.customerName}</p>
          {invoice.customerTaxId && (
            <p className="text-gray-600">
              {taxIdLabel}: {invoice.customerTaxId}
            </p>
          )}
          {invoice.customerAddress && (
            <p className="whitespace-pre-line text-gray-600">
              {invoice.customerAddress}
            </p>
          )}
          {invoice.customerEmail && (
            <p className="text-gray-600">{invoice.customerEmail}</p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {t.date}
          </p>
          <p className="font-semibold">{invoice.invoiceDate}</p>
        </div>
        <div>
          {invoice.dueDate && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {t.dueDate}
              </p>
              <p className="font-semibold">{invoice.dueDate}</p>
            </>
          )}
        </div>
      </div>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y border-gray-300 text-[10px] uppercase tracking-wider text-gray-500">
            <th className="px-2 py-1 text-start">{t.description}</th>
            <th className="px-2 py-1 text-center">{t.quantity}</th>
            <th className="px-2 py-1 text-right">{t.unitPrice}</th>
            <th className="px-2 py-1 text-right">{t.total}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="px-2 py-1">{item.description}</td>
              <td className="px-2 py-1 text-center text-gray-600">
                {item.quantity}
              </td>
              <td className="px-2 py-1 text-right text-gray-600">
                {fmt(item.unitPrice)}
              </td>
              <td className="px-2 py-1 text-right font-medium">
                {fmt(item.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <InvoiceTotalsFooter config={config} invoice={invoice} />


      {invoice.notes && (
        <div className="mt-4 border-t border-gray-200 pt-2 text-gray-600">
          <span className="font-semibold text-gray-700">{t.notes}: </span>
          <span className="whitespace-pre-line">{invoice.notes}</span>
        </div>
      )}
      {/* Footer blocks — payments on receipts, bank transfer details on
          documents that request payment. Mutually exclusive by type. */}
      {invoice.payments && invoice.payments.length > 0 && (
        <PaymentBlock
          payments={invoice.payments}
          language={invoice.language}
          accentColor={config.accentColor}
        />
      )}
      <BankDetailsBlock config={config} invoice={invoice} />
    </div>
  );
}
