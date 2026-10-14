import { getKnownRateToIls } from "@/lib/fx";
import { buildForeignExchangeDisplay } from "./foreign-exchange-display";

export interface StatutoryIlsAmounts {
  subtotal: number;
  vatAmount: number;
  total: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toNumber(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The ILS rate for a document: the one frozen on it at issue
 * (`fx_rate_to_ils`) when present, otherwise today's (drafts, and documents
 * issued before the rate was frozen).
 */
export function ilsRateFor(currency: string, fxRateToIls?: number | string | null): number {
  const frozen = Number(fxRateToIls);
  if (fxRateToIls != null && Number.isFinite(frozen) && frozen > 0) return frozen;
  const known = getKnownRateToIls(currency);
  if (known == null) throw new MissingExchangeRateError(currency);
  return known;
}

/**
 * A foreign-currency amount had to be stated in ILS and no Bank of Israel
 * rate is known: the document has none frozen and none was loaded. Refusing
 * beats reporting foreign amounts as shekels or at an invented rate.
 */
export class MissingExchangeRateError extends Error {
  constructor(readonly currency: string) {
    super(
      `No Bank of Israel exchange rate is available for ${currency}, so its ILS amounts cannot be stated. Try again when the rate can be fetched.`,
    );
    this.name = "MissingExchangeRateError";
  }
}

/**
 * Statutory ILS figures for Israeli accounting exports (MOVEIN, uniform
 * structure) and the ITA allocation request. Matches the ILS totals printed
 * on issued tax invoices ({@link buildForeignExchangeDisplay} uses the same
 * rate):
 * - ILS documents → stored amounts as-is
 * - foreign currency → the document's frozen rate, else today's
 */
export function toStatutoryIlsAmounts(doc: {
  currency?: string | null;
  subtotal: number | string;
  vatAmount?: number | string | null;
  total: number | string;
  fxRateToIls?: number | string | null;
}): StatutoryIlsAmounts {
  const subtotal = toNumber(doc.subtotal);
  const vatAmount = toNumber(doc.vatAmount);
  const total = toNumber(doc.total);

  const fx = buildForeignExchangeDisplay({
    currency: doc.currency ?? "ILS",
    subtotal,
    vatAmount,
    total,
    fxRateToIls: doc.fxRateToIls,
  });
  if (fx) {
    return {
      subtotal: fx.ilsSubtotal,
      vatAmount: fx.ilsVatAmount,
      total: fx.ilsTotal,
    };
  }
  const cur = (doc.currency ?? "ILS").toUpperCase();
  if (cur !== "ILS" && cur !== "NIS") throw new MissingExchangeRateError(cur);
  return {
    subtotal: round2(subtotal),
    vatAmount: round2(vatAmount),
    total: round2(total),
  };
}

/** Convert a single document-currency amount to statutory ILS. */
export function toStatutoryIlsAmount(
  amount: number | string,
  currency?: string | null,
  fxRateToIls?: number | string | null,
): number {
  const n = toNumber(amount);
  const cur = (currency ?? "ILS").toUpperCase();
  if (cur === "ILS" || cur === "NIS") return round2(n);
  return round2(n * ilsRateFor(cur, fxRateToIls));
}
