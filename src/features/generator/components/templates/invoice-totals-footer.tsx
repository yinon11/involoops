"use client";

import type { TemplateRendererProps } from "@/types/template";
import { showsVatBreakdown } from "@/lib/documents/vat";
import { fxRateLabel } from "@/lib/outbound/foreign-exchange-display";

const labels = {
  en: {
    subtotal: "Subtotal",
    vat: "VAT",
    totalDue: "Total due",
    subtotalIls: "Subtotal (ILS)",
    vatIls: "VAT (ILS)",
    totalDueIls: "Total due (ILS)",
  },
  he: {
    subtotal: "סכום לפני מע״מ",
    vat: "מע״מ",
    totalDue: "סה״כ לתשלום",
    subtotalIls: "סכום לפני מע״מ (₪)",
    vatIls: "מע״מ (₪)",
    totalDueIls: "סה״כ לתשלום (₪)",
  },
} as const;

function formatCurrency(amount: number, currency: string, lang: string) {
  return new Intl.NumberFormat(lang === "he" ? "he-IL" : "en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

type Props = Pick<TemplateRendererProps, "config" | "invoice">;

export function InvoiceTotalsFooter({ config, invoice }: Props) {
  const lang = invoice.language === "he" ? "he" : "en";
  const t = labels[lang];
  const fx = invoice.foreignExchange;
  const fmtIls = (n: number) => formatCurrency(n, "ILS", lang);
  // A receipt drops both rows and shows only the total — see
  // `showsVatBreakdown`.
  const withVat = showsVatBreakdown(invoice.documentType);

  if (fx) {
    return (
      <div className="mt-6 flex">
        <div className="ml-auto w-72 space-y-2 text-sm">
          <div className="flex justify-between border-b border-dashed border-gray-300 pb-2">
            <span className="text-gray-500">{fxRateLabel(lang, fx.currency)}</span>
            <span className="font-mono font-semibold tabular-nums">{fx.rate}</span>
          </div>
          {withVat && (
            <div className="flex justify-between">
              <span className="text-gray-500">{t.subtotalIls}</span>
              <span>{fmtIls(fx.ilsSubtotal)}</span>
            </div>
          )}
          {withVat && config.showVatBreakdown && (
            <div className="flex justify-between">
              <span className="text-gray-500">
                {t.vatIls} ({invoice.vatRate}%)
              </span>
              <span>{fmtIls(fx.ilsVatAmount)}</span>
            </div>
          )}
          <div
            className="flex justify-between border-t-2 pt-2 text-base font-bold"
            style={{ borderColor: config.accentColor }}
          >
            <span>{t.totalDueIls}</span>
            <span style={{ color: config.accentColor }}>{fmtIls(fx.ilsTotal)}</span>
          </div>
        </div>
      </div>
    );
  }

  const fmt = (n: number) => formatCurrency(n, invoice.currency, lang);
  return (
    <div className="mt-6 flex">
      <div className="ml-auto w-64 space-y-2 text-sm">
        {withVat && (
          <div className="flex justify-between">
            <span className="text-gray-500">{t.subtotal}</span>
            <span>{fmt(invoice.subtotal)}</span>
          </div>
        )}
        {withVat && config.showVatBreakdown && (
          <div className="flex justify-between">
            <span className="text-gray-500">
              {t.vat} ({invoice.vatRate}%)
            </span>
            <span>{fmt(invoice.vatAmount)}</span>
          </div>
        )}
        <div
          className="flex justify-between border-t-2 pt-2 text-base font-bold"
          style={{ borderColor: config.accentColor }}
        >
          <span>{t.totalDue}</span>
          <span style={{ color: config.accentColor }}>{fmt(invoice.total)}</span>
        </div>
      </div>
    </div>
  );
}
