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

/**
 * Bold — high-contrast accent header with reversed-out title block.
 * Suited for studios/freelancers who want their invoices to stand out
 * in a client's inbox.
 */
export function BoldTemplate({ config, invoice }: TemplateRendererProps) {
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
      <header
        className="-mx-8 -mt-8 px-8 py-8 text-white"
        style={{ backgroundColor: config.accentColor }}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/70">
              {heading}
              {marker ? ` · ${marker}` : ""}
            </p>
            <h1 className="font-mono text-4xl font-black tracking-tight">
              {invoice.invoiceNumber}
            </h1>
            <AllocationNumberLine
              allocationNumber={invoice.allocationNumber}
              lang={lang}
              tone="inverse"
              className="mt-1"
            />
          </div>
          <div className="flex items-center gap-4 text-right">
            {config.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={config.logoUrl}
                alt=""
                className="h-12 w-12 rounded bg-white/10 object-contain p-1"
              />
            )}
            <div>
              <p className="text-base font-bold">{config.businessName}</p>
              {config.businessTaxId && (
                <p className="text-xs text-white/80">
                  <span className="text-white/60">{taxIdLabel}:</span>{" "}
                  <span className="font-mono">{config.businessTaxId}</span>
                </p>
              )}
              {config.businessEmail && (
                <p className="text-xs text-white/70">{config.businessEmail}</p>
              )}
              {config.businessWebsite && (
                <p className="text-xs text-white/70">{config.businessWebsite}</p>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-3 gap-6 text-sm">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
            {t.billTo}
          </p>
          <p className="mt-1 font-bold">{invoice.customerName}</p>
          {invoice.customerEmail && (
            <p className="text-xs text-gray-500">{invoice.customerEmail}</p>
          )}
          {invoice.customerAddress && (
            <p className="whitespace-pre-line text-xs text-gray-500">
              {invoice.customerAddress}
            </p>
          )}
          {invoice.customerTaxId && (
            <p className="text-xs text-gray-500">
              {taxIdLabel}: {invoice.customerTaxId}
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
            {t.date}
          </p>
          <p className="mt-1 font-bold">{invoice.invoiceDate}</p>
        </div>
        <div>
          {invoice.dueDate && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                {t.dueDate}
              </p>
              <p className="mt-1 font-bold">{invoice.dueDate}</p>
            </>
          )}
        </div>
      </div>

      <table className="mt-10 w-full border-collapse text-sm">
        <thead>
          <tr
            className="text-[10px] font-bold uppercase tracking-[0.2em] text-white"
            style={{ backgroundColor: config.accentColor }}
          >
            <th className="px-4 py-3 text-start">{t.description}</th>
            <th className="px-4 py-3 text-center">{t.quantity}</th>
            <th className="px-4 py-3 text-right">{t.unitPrice}</th>
            <th className="px-4 py-3 text-right">{t.total}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, i) => (
            <tr
              key={i}
              className={
                i % 2 === 0 ? "bg-gray-100" : "bg-white"
              }
            >
              <td className="px-4 py-3 font-medium">{item.description}</td>
              <td className="px-4 py-3 text-center">{item.quantity}</td>
              <td className="px-4 py-3 text-right">{fmt(item.unitPrice)}</td>
              <td className="px-4 py-3 text-right font-bold">
                {fmt(item.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <InvoiceTotalsFooter config={config} invoice={invoice} />


      {invoice.notes && (
        <div
          className="mt-10 border-s-4 bg-gray-100 p-4 text-sm"
          style={{ borderColor: config.accentColor }}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
            {t.notes}
          </p>
          <p className="mt-1 whitespace-pre-line text-gray-700">
            {invoice.notes}
          </p>
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
