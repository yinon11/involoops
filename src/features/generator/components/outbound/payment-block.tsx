"use client";

import type { PaymentEntry } from "@/lib/documents/payments";
import {
  FooterCard,
  FooterPairs,
} from "@/features/generator/components/outbound/footer-card";

/**
 * Rendered payment block for on-screen preview of TIR / RECEIPT
 * documents. The HTML-string renderer in
 * `src/lib/pdf/render-invoice-html.ts` mirrors this layout for the
 * PDF path — keep them visually consistent.
 *
 * Shares `FooterCard` with `BankDetailsBlock` so a receipt and an invoice read
 * alike, and renders in the same slot at the bottom of the body. One payment
 * collapses to a single line; several keep the table.
 */

interface Props {
  payments: PaymentEntry[];
  language: string;
  accentColor: string;
}

const labels = {
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

function fmt(amount: number, currency: string, lang: string) {
  return new Intl.NumberFormat(lang === "he" ? "he-IL" : "en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

export function PaymentBlock({ payments, language, accentColor }: Props) {
  if (payments.length === 0) return null;
  const lang = language === "he" ? "he" : "en";
  const t = labels[lang];
  const currency = payments[0]?.currency ?? "ILS";
  const total = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const methodLabel = (p: PaymentEntry) => t.method[p.method] ?? p.method;
  const aside = (
    <span className="font-mono font-semibold tabular-nums text-gray-800">
      {fmt(total, currency, lang)}
    </span>
  );

  if (payments.length === 1) {
    const p = payments[0];
    return (
      <FooterCard accentColor={accentColor} title={t.title} aside={aside}>
        <FooterPairs
          pairs={[
            { label: t.methodCol, value: methodLabel(p) },
            { label: t.dateCol, value: p.date },
            ...(p.reference
              ? [{ label: t.referenceCol, value: p.reference }]
              : []),
          ]}
        />
      </FooterCard>
    );
  }

  return (
    <FooterCard accentColor={accentColor} title={t.title} aside={aside}>
      <table className="w-full text-gray-600">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-400">
            <th className="pb-0.5 text-start font-semibold">{t.methodCol}</th>
            <th className="px-2 pb-0.5 text-start font-semibold">{t.dateCol}</th>
            <th className="px-2 pb-0.5 text-start font-semibold">
              {t.referenceCol}
            </th>
            <th className="pb-0.5 text-right font-semibold">{t.amountCol}</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p, i) => (
            <tr key={i}>
              <td className="py-0.5">{methodLabel(p)}</td>
              <td className="px-2 py-0.5 text-gray-500">{p.date}</td>
              <td className="px-2 py-0.5 font-mono text-gray-500">
                {p.reference ?? "—"}
              </td>
              <td className="py-0.5 text-right font-mono tabular-nums text-gray-800">
                {fmt(Number(p.amount) || 0, p.currency, lang)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </FooterCard>
  );
}
