import type { InvoiceData } from "@/types/template";
import { getKnownRateToIls } from "@/lib/fx";

export interface ForeignExchangeDisplay {
  /** The document currency the rate is for, e.g. "USD". */
  currency: string;
  /** ILS per 1 unit of `currency` (e.g. 3.1). */
  rate: number;
  ilsSubtotal: number;
  ilsVatAmount: number;
  ilsTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Israeli tax invoices: line amounts stay in the document currency (as stored);
 * the totals footer shows the statutory ILS figures via an explicit FX rate.
 */
export function buildForeignExchangeDisplay(
  invoice: Pick<InvoiceData, "currency" | "subtotal" | "vatAmount" | "total"> & {
    /** Frozen at issue; wins over everything else. */
    fxRateToIls?: number | string | null;
  },
  /**
   * Explicit ILS-per-USD rate. Pass this from a server context that has
   * warmed the daily Bank-of-Israel rate (e.g. the create form, which is a
   * client component and can't read the server's in-memory cache itself).
   * When omitted, falls back to the synchronous display-rate helper.
   */
  rateOverride?: number,
): ForeignExchangeDisplay | null {
  const cur = (invoice.currency ?? "ILS").toUpperCase();
  if (cur === "ILS" || cur === "NIS") return null;

  // An issued document prints the rate it was issued at, never today's.
  const frozen = Number(invoice.fxRateToIls);
  const rate =
    invoice.fxRateToIls != null && Number.isFinite(frozen) && frozen > 0
      ? frozen
      : rateOverride != null && Number.isFinite(rateOverride) && rateOverride > 0
        ? rateOverride
        : getKnownRateToIls(cur);
  // No Bank of Israel rate known: show no ILS figures rather than invent them.
  if (rate == null) return null;
  return {
    currency: cur,
    rate,
    ilsSubtotal: round2(invoice.subtotal * rate),
    ilsVatAmount: round2(invoice.vatAmount * rate),
    ilsTotal: round2(invoice.total * rate),
  };
}

/** Attach `foreignExchange` and show payment totals in ILS when applicable. */
export function withForeignExchangeDisplay(
  invoice: InvoiceData,
  rateOverride?: number,
): InvoiceData {
  const foreignExchange = buildForeignExchangeDisplay(invoice, rateOverride);
  if (!foreignExchange) return invoice;

  const payments =
    invoice.payments?.map((p, i) =>
      i === 0
        ? {
            ...p,
            amount: foreignExchange.ilsTotal,
            currency: "ILS",
          }
        : { ...p, currency: "ILS" },
    ) ?? invoice.payments;

  return { ...invoice, foreignExchange, payments };
}

const HE_RATE_LABEL: Record<string, string> = {
  USD: "שער דולר",
  EUR: "שער אירו",
  GBP: "שער ליש״ט",
};

/** The label printed next to the rate, e.g. "USD exchange rate" / "שער דולר". */
export function fxRateLabel(language: "he" | "en", currency: string): string {
  const cur = currency.toUpperCase();
  return language === "he"
    ? (HE_RATE_LABEL[cur] ?? `שער ${cur}`)
    : `${cur} exchange rate`;
}
