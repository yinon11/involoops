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
    billTo: "Billed to",
    from: "From",
    invoiceNumber: "Document #",
    date: "Issue date",
    dueDate: "Due date",
    description: "Description",
    quantity: "Quantity",
    unitPrice: "Price per unit",
    total: "Amount",
    subtotal: "Subtotal",
    vat: "VAT",
    totalDue: "Amount due",
    notes: "Notes",
  },
  he: {
    billTo: "לכבוד",
    from: "מאת",
    invoiceNumber: "מספר מסמך",
    date: "תאריך הנפקה",
    dueDate: "תאריך תשלום",
    description: "תיאור",
    quantity: "כמות",
    unitPrice: "מחיר יחידה",
    total: "סכום",
    subtotal: "סכום לפני מע״מ",
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

export function ModernTemplate({ config, invoice }: TemplateRendererProps) {
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
      className="bg-white text-gray-800"
      style={{ fontFamily: lang === "he" ? "'Heebo', sans-serif" : "inherit" }}
    >
      {/* Accent bar */}
      <div className="h-2 w-full rounded-t" style={{ backgroundColor: config.accentColor }} />

      {/* Header */}
      <div className="mt-6 flex items-start justify-between">
        <div className="flex items-center gap-4">
          {config.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoUrl} alt="" className="h-14 w-14 rounded-lg object-contain" />
          )}
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {config.businessName}
            </h2>
            {config.businessTaxId && (
              <p className="text-xs text-gray-700">
                <span className="text-gray-500">{taxIdLabel}:</span>{" "}
                <span className="font-mono font-semibold">{config.businessTaxId}</span>
              </p>
            )}
            {config.businessEmail && (
              <p className="text-xs text-gray-500">{config.businessEmail}</p>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <h1
              className="text-2xl font-black tracking-tight"
              style={{ color: config.accentColor }}
            >
              {heading}
            </h1>
            {marker && (
              <span
                className="rounded border px-2 py-0.5 text-xs font-semibold"
                style={{ borderColor: config.accentColor, color: config.accentColor }}
              >
                {marker}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-semibold text-gray-600">
            #{invoice.invoiceNumber}
          </p>
          <AllocationNumberLine
            allocationNumber={invoice.allocationNumber}
            lang={lang}
            className="mt-1 text-right"
          />
        </div>
      </div>

      {/* Two-column info */}
      <div className="mt-8 grid grid-cols-2 gap-8">
        {/* From (issuer — המוציא) */}
        <div className="rounded-lg bg-gray-50 p-4">
          <h3
            className="mb-2 text-xs font-bold uppercase tracking-wider"
            style={{ color: config.accentColor }}
          >
            {t.from}
          </h3>
          <p className="text-sm font-bold">{config.businessName}</p>
          {config.businessTaxId && (
            <p className="text-xs text-gray-700">
              <span className="text-gray-500">{taxIdLabel}:</span>{" "}
              <span className="font-mono font-semibold">{config.businessTaxId}</span>
            </p>
          )}
          {config.businessAddress && (
            <p className="mt-1 whitespace-pre-line text-xs text-gray-600">
              {config.businessAddress}
            </p>
          )}
          {config.businessPhone && (
            <p className="text-xs text-gray-600">{config.businessPhone}</p>
          )}
          {config.businessWebsite && (
            <p className="text-xs text-gray-600">{config.businessWebsite}</p>
          )}
        </div>
        {/* Bill To */}
        <div className="rounded-lg bg-gray-50 p-4">
          <h3
            className="mb-2 text-xs font-bold uppercase tracking-wider"
            style={{ color: config.accentColor }}
          >
            {t.billTo}
          </h3>
          <p className="text-sm font-semibold">{invoice.customerName}</p>
          {invoice.customerEmail && (
            <p className="mt-1 text-xs text-gray-600">{invoice.customerEmail}</p>
          )}
          {invoice.customerAddress && (
            <p className="whitespace-pre-line text-xs text-gray-600">
              {invoice.customerAddress}
            </p>
          )}
          {invoice.customerTaxId && (
            <p className="text-xs text-gray-600">
              {taxIdLabel}: {invoice.customerTaxId}
            </p>
          )}
        </div>
      </div>

      {/* Date details */}
      <div className="mt-6 flex gap-6 text-sm">
        <div
          className="rounded-md px-4 py-2"
          style={{ backgroundColor: `${config.accentColor}10` }}
        >
          <span className="text-xs text-gray-500">{t.date}</span>
          <p className="font-semibold">{invoice.invoiceDate}</p>
        </div>
        {invoice.dueDate && (
          <div
            className="rounded-md px-4 py-2"
            style={{ backgroundColor: `${config.accentColor}10` }}
          >
            <span className="text-xs text-gray-500">{t.dueDate}</span>
            <p className="font-semibold">{invoice.dueDate}</p>
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="mt-8 overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-start text-xs font-bold uppercase tracking-wider text-gray-500">
                {t.description}
              </th>
              <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-gray-500">
                {t.quantity}
              </th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-500">
                {t.unitPrice}
              </th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-500">
                {t.total}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invoice.items.map((item, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-3">{item.description}</td>
                <td className="px-4 py-3 text-center text-gray-600">
                  {item.quantity}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {fmt(item.unitPrice)}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {fmt(item.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InvoiceTotalsFooter config={config} invoice={invoice} />


      {/* Notes */}
      {invoice.notes && (
        <div
          className="mt-8 border-s-4 py-2 ps-4 text-sm"
          style={{ borderColor: config.accentColor }}
        >
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">
            {t.notes}
          </p>
          <p className="whitespace-pre-line text-gray-600">{invoice.notes}</p>
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
