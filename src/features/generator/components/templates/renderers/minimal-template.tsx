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

/**
 * Minimal — extreme whitespace, monochrome with a single accent rule.
 * Stripe-receipt vibe; great for service businesses that want their
 * brand colour to feel restrained rather than dominant.
 */
export function MinimalTemplate({ config, invoice }: TemplateRendererProps) {
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
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          {config.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={config.logoUrl}
              alt=""
              className="mb-4 h-10 w-auto object-contain"
            />
          )}
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400">
            {heading}
            {marker ? ` · ${marker}` : ""}
          </p>
          <p className="font-mono text-2xl tracking-tight text-gray-900">
            {invoice.invoiceNumber}
          </p>
          <AllocationNumberLine
            allocationNumber={invoice.allocationNumber}
            lang={lang}
            className="mt-2"
          />
        </div>
        <div className="text-right text-xs leading-relaxed text-gray-500">
          <p className="text-sm font-semibold text-gray-900">
            {config.businessName}
          </p>
          {config.businessTaxId && (
            <p>
              <span className="text-gray-400">{taxIdLabel}:</span>{" "}
              <span className="font-mono">{config.businessTaxId}</span>
            </p>
          )}
          {config.businessAddress && (
            <p className="whitespace-pre-line">{config.businessAddress}</p>
          )}
          {config.businessEmail && <p>{config.businessEmail}</p>}
          {config.businessPhone && <p>{config.businessPhone}</p>}
          {config.businessWebsite && <p>{config.businessWebsite}</p>}
        </div>
      </div>

      <div
        className="mt-10 h-px w-full"
        style={{ backgroundColor: config.accentColor }}
      />

      <div className="mt-8 grid grid-cols-2 gap-12 text-sm">
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-gray-400">
            {t.billTo}
          </p>
          <p className="font-medium text-gray-900">{invoice.customerName}</p>
          {invoice.customerEmail && (
            <p className="text-gray-500">{invoice.customerEmail}</p>
          )}
          {invoice.customerAddress && (
            <p className="whitespace-pre-line text-gray-500">
              {invoice.customerAddress}
            </p>
          )}
          {invoice.customerTaxId && (
            <p className="text-gray-500">
              {taxIdLabel}: {invoice.customerTaxId}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">
            {t.date}
          </p>
          <p className="font-medium">{invoice.invoiceDate}</p>
          {invoice.dueDate && (
            <>
              <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-gray-400">
                {t.dueDate}
              </p>
              <p className="font-medium">{invoice.dueDate}</p>
            </>
          )}
        </div>
      </div>

      <table className="mt-12 w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-[10px] uppercase tracking-[0.2em] text-gray-400">
            <th className="pb-3 text-start font-normal">{t.description}</th>
            <th className="pb-3 text-center font-normal">{t.quantity}</th>
            <th className="pb-3 text-right font-normal">{t.unitPrice}</th>
            <th className="pb-3 text-right font-normal">{t.total}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-3 pe-4">{item.description}</td>
              <td className="py-3 text-center text-gray-500">
                {item.quantity}
              </td>
              <td className="py-3 text-right text-gray-500">
                {fmt(item.unitPrice)}
              </td>
              <td className="py-3 text-right font-medium">{fmt(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <InvoiceTotalsFooter config={config} invoice={invoice} />


      {invoice.notes && (
        <div className="mt-10 text-sm text-gray-500">
          <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-gray-400">
            {t.notes}
          </p>
          <p className="whitespace-pre-line">{invoice.notes}</p>
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
