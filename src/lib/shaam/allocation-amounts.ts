import { ilsRateFor, toStatutoryIlsAmounts } from "@/lib/outbound/statutory-ils-amounts";
import { negateMoney, formatMoney } from "@/lib/money";


/**
 * The amounts an allocation decision is made on: in ILS, whatever the
 * document's currency.
 *
 * The obligation is tested on the ILS value before VAT (the accountant,
 * 2026-10: "המבחן הקובע לחובת מספר הקצאה הוא סכום החשבונית בשקלים"), at
 * the Bank of Israel representative rate — the one frozen on the document
 * at issue, or today's for a draft. The ITA API has no currency field
 * either: everything it receives is ILS.
 *
 * A credit note's pre-VAT amount comes back negative, as
 * `requiresAllocation` expects from its callers.
 */
export function allocationAmountsIls(doc: {
  documentType: string;
  currency?: string | null;
  subtotal: string | number;
  vatAmount?: string | number | null;
  total: string | number;
  fxRateToIls?: string | number | null;
}): { preVatAmount: string; vatAmount: string; currency: "ILS" } {
  const ils = toStatutoryIlsAmounts(doc);
  const preVat = formatMoney(Math.abs(ils.subtotal));
  return {
    preVatAmount:
      doc.documentType === "CREDIT_INVOICE" ? negateMoney(preVat) : preVat,
    vatAmount: formatMoney(ils.vatAmount),
    currency: "ILS",
  };
}

/**
 * The money fields of an allocation request, in ILS. Unchanged for an ILS
 * document. For a foreign-currency one: the document totals as printed
 * ({@link toStatutoryIlsAmounts}, same rate), and each line's unit price
 * converted at that rate — the payload builder derives line totals and
 * VAT from it the same way it does for an ILS document.
 */
export function ilsPayloadAmounts<
  L extends { unitPrice: number; total: number },
>(doc: {
  currency?: string | null;
  items: L[];
  subtotal: string | number;
  vatAmount?: string | number | null;
  total: string | number;
  fxRateToIls?: string | number | null;
}): {
  items: L[];
  subtotal: string;
  vatAmount: string;
  total: string;
  currency: string;
  /** ILS per 1 unit; 1 for an ILS document. */
  rate: number;
} {
  const cur = (doc.currency ?? "ILS").toUpperCase();
  if (cur === "ILS" || cur === "NIS") {
    return {
      items: doc.items,
      subtotal: formatMoney(doc.subtotal),
      vatAmount: formatMoney(doc.vatAmount ?? 0),
      total: formatMoney(doc.total),
      currency: "ILS",
      rate: 1,
    };
  }
  const ils = toStatutoryIlsAmounts(doc);
  // The same rate `toStatutoryIlsAmounts` used: frozen, else the latest
  // loaded BOI rate (both throw when none is known).
  const rate = ilsRateFor(cur, doc.fxRateToIls);
  return {
    items: doc.items.map((line) => ({
      ...line,
      unitPrice: line.unitPrice * rate,
      total: Math.round(line.total * rate * 100) / 100,
    })),
    subtotal: formatMoney(ils.subtotal),
    vatAmount: formatMoney(ils.vatAmount),
    total: formatMoney(ils.total),
    currency: "ILS",
    rate,
  };
}
