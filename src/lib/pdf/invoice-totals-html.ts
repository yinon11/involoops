import type { TemplateConfig } from "@/types/template";
import type { InvoiceData } from "@/types/template";
import { showsVatBreakdown } from "@/lib/documents/vat";
import { fxRateLabel } from "@/lib/outbound/foreign-exchange-display";

type TotalsLabels = {
  subtotal: string;
  vat: string;
  totalDue: string;
  subtotalIls: string;
  vatIls: string;
  totalDueIls: string;
};

export function renderInvoiceTotalsHtml(
  invoice: InvoiceData,
  config: TemplateConfig,
  t: TotalsLabels,
  c: (n: number) => string,
  cIls: (n: number) => string,
  ac: string,
): string {
  const fx = invoice.foreignExchange;
  // A receipt drops both rows and shows only the total — see
  // `showsVatBreakdown`.
  const withVat = showsVatBreakdown(invoice.documentType);
  const vatRow =
    withVat && config.showVatBreakdown
      ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="color:#6b7280">${fx ? t.vatIls : t.vat} (${invoice.vatRate}%)</span>
        <span>${fx ? cIls(fx.ilsVatAmount) : c(invoice.vatAmount)}</span>
      </div>`
      : "";

  if (fx) {
    return `
    <div style="display:flex;margin-top:24px">
      <div style="width:288px;margin-left:auto;font-size:13px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed #d1d5db">
          <span style="color:#6b7280">${fxRateLabel(invoice.language === "he" ? "he" : "en", fx.currency)}</span>
          <span style="font-family:ui-monospace,monospace;font-weight:600">${fx.rate}</span>
        </div>
        ${
          withVat
            ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#6b7280">${t.subtotalIls}</span><span>${cIls(fx.ilsSubtotal)}</span>
        </div>`
            : ""
        }
        ${vatRow}
        <div style="display:flex;justify-content:space-between;border-top:2px solid ${ac};padding-top:8px;margin-top:8px;font-size:16px;font-weight:700">
          <span>${t.totalDueIls}</span><span style="color:${ac}">${cIls(fx.ilsTotal)}</span>
        </div>
      </div>
    </div>`;
  }

  return `
    <div style="display:flex;margin-top:24px">
      <div style="width:256px;margin-left:auto;font-size:13px">
        ${
          withVat
            ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#6b7280">${t.subtotal}</span><span>${c(invoice.subtotal)}</span>
        </div>`
            : ""
        }
        ${vatRow}
        <div style="display:flex;justify-content:space-between;border-top:2px solid ${ac};padding-top:8px;margin-top:8px;font-size:16px;font-weight:700">
          <span>${t.totalDue}</span><span style="color:${ac}">${c(invoice.total)}</span>
        </div>
      </div>
    </div>`;
}
