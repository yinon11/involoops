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
    billTo: "Bill To",
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
    totalDue: "Total due",
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
    total: "סה״כ",
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

export function ClassicTemplate({ config, invoice }: TemplateRendererProps) {
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
      className="bg-white text-gray-900"
      style={{ fontFamily: lang === "he" ? "'Heebo', sans-serif" : "inherit" }}
    >
      {/* Header — document type literal + original/copy marker, issuer block */}
      <div
        className="flex items-start justify-between border-b-2 pb-6"
        style={{ borderColor: config.accentColor }}
      >
        <div>
          {config.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoUrl} alt="" className="mb-3 h-16 w-auto object-contain" />
          )}
          <div className="flex items-baseline gap-3">
            <h1
              className="text-3xl font-bold"
              style={{ color: config.accentColor }}
            >
              {heading}
            </h1>
            {marker && (
              <span
                className="rounded border px-2 py-0.5 text-sm font-semibold"
                style={{ borderColor: config.accentColor, color: config.accentColor }}
              >
                {marker}
              </span>
            )}
          </div>
        </div>

        {/* Issuer block (המוציא) — prominent per ITA: name bold + explicit tax-id label */}
        <div className="text-right text-sm text-gray-700">
          <p className="text-base font-bold text-gray-900">
            {config.businessName}
          </p>
          {config.businessTaxId && (
            <p className="text-gray-900">
              <span className="text-gray-500">{taxIdLabel}:</span>{" "}
              <span className="font-mono font-semibold">{config.businessTaxId}</span>
            </p>
          )}
          {config.businessAddress && (
            <p className="whitespace-pre-line">{config.businessAddress}</p>
          )}
          {config.businessPhone && <p>{config.businessPhone}</p>}
          {config.businessEmail && <p>{config.businessEmail}</p>}
          {config.businessWebsite && <p>{config.businessWebsite}</p>}
        </div>
      </div>

      {/* Invoice meta + Bill To */}
      <div className="mt-6 flex justify-between gap-8">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            {t.billTo}
          </h3>
          <p className="font-semibold">{invoice.customerName}</p>
          {invoice.customerEmail && (
            <p className="text-sm text-gray-600">{invoice.customerEmail}</p>
          )}
          {invoice.customerAddress && (
            <p className="whitespace-pre-line text-sm text-gray-600">
              {invoice.customerAddress}
            </p>
          )}
          {invoice.customerTaxId && (
            <p className="text-sm text-gray-600">
              {taxIdLabel}: {invoice.customerTaxId}
            </p>
          )}
        </div>
        <div className="text-right text-sm">
          <div className="space-y-1">
            <p>
              <span className="text-gray-500">{t.invoiceNumber}:</span>{" "}
              <span className="font-semibold">{invoice.invoiceNumber}</span>
            </p>
            <AllocationNumberLine
              allocationNumber={invoice.allocationNumber}
              lang={lang}
            />
            <p>
              <span className="text-gray-500">{t.date}:</span> {invoice.invoiceDate}
            </p>
            {invoice.dueDate && (
              <p>
                <span className="text-gray-500">{t.dueDate}:</span>{" "}
                {invoice.dueDate}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Line items table */}
      <table className="mt-8 w-full text-sm">
        <thead>
          <tr style={{ backgroundColor: config.accentColor }} className="text-white">
            <th className="px-4 py-2 text-start">{t.description}</th>
            <th className="px-4 py-2 text-center">{t.quantity}</th>
            <th className="px-4 py-2 text-right">{t.unitPrice}</th>
            <th className="px-4 py-2 text-right">{t.total}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-gray-50" : "bg-white"}>
              <td className="px-4 py-2">{item.description}</td>
              <td className="px-4 py-2 text-center">{item.quantity}</td>
              <td className="px-4 py-2 text-right">{fmt(item.unitPrice)}</td>
              <td className="px-4 py-2 text-right">{fmt(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <InvoiceTotalsFooter config={config} invoice={invoice} />


      {/* Notes */}
      {invoice.notes && (
        <div className="mt-8 rounded border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="mb-1 font-semibold text-gray-700">{t.notes}</p>
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
