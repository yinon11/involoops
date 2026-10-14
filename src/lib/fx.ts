/**
 * Approximate FX for dashboard totals and extraction hints.
 * Override via env (rates multiply source currency → USD).
 */

import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { invoices } from '@/db/schema/invoices';
import type { ExtractedInvoiceData } from '@/types/invoice';
import { getLatestCachedRateToIls } from '@/lib/fx/usd-ils-cache';

function numEnv(key: string, fallback: number): number {
  const v = process.env[key];
  if (v == null || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Currencies the app can aggregate into. Unknown codes still extract per-invoice
 * but cannot be used as a dashboard display currency (no FX multiplier).
 */
export const SUPPORTED_DISPLAY_CURRENCIES = ['USD', 'ILS', 'EUR', 'GBP'] as const;
export type SupportedDisplayCurrency =
  (typeof SUPPORTED_DISPLAY_CURRENCIES)[number];

export function isSupportedDisplayCurrency(
  code: string
): code is SupportedDisplayCurrency {
  return (SUPPORTED_DISPLAY_CURRENCIES as readonly string[]).includes(code);
}

/** Env-wide fallback when a user has no preference set. */
export function getDefaultDisplayCurrency(): string {
  const c = process.env.DEFAULT_DISPLAY_CURRENCY?.trim();
  return c && c.length >= 3 ? c.toUpperCase() : 'ILS';
}

/**
 * Resolve the display currency for a request.
 * Order: user preference (if valid + supported) → env default → 'ILS'.
 */
export function resolveDisplayCurrency(
  userCurrency: string | null | undefined
): string {
  if (userCurrency && userCurrency.trim().length === 3) {
    const u = userCurrency.trim().toUpperCase();
    if (isSupportedDisplayCurrency(u)) return u;
  }
  const envDefault = getDefaultDisplayCurrency();
  if (isSupportedDisplayCurrency(envDefault)) return envDefault;
  return 'ILS';
}

/**
 * Multiplier: 1 unit of `currency` → USD (e.g. 1 ILS → 0.27 USD).
 * Defaults are rough; set FX_*_TO_USD in env for your period.
 */
export function getFxToUsdMultiplier(currency: string): number {
  const u = currency.toUpperCase();
  if (u === 'USD') return 1;
  if (u === 'ILS' || u === 'NIS') {
    return numEnv('FX_ILS_TO_USD', 0.27);
  }
  if (u === 'EUR') {
    return numEnv('FX_EUR_TO_USD', 1.08);
  }
  if (u === 'GBP') {
    return numEnv('FX_GBP_TO_USD', 1.27);
  }
  return 1;
}

export function convertAmountToUsd(amount: number, currency: string | null): number {
  const m = getFxToUsdMultiplier(currency ?? 'ILS');
  return Math.round(amount * m * 100) / 100;
}

/**
 * Convert between supported currencies via USD (same rates as dashboard FX).
 */
export function convertAmountBetweenCurrencies(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
): number {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) return Math.round(amount * 100) / 100;
  const inUsd = amount * getFxToUsdMultiplier(from);
  const target = inUsd / getFxToUsdMultiplier(to);
  return Math.round(target * 100) / 100;
}

/** USD charge → ILS for Israeli tax documents (uses `FX_ILS_TO_USD`). */
export function convertUsdToIls(amountUsd: number): number {
  return convertAmountBetweenCurrencies(amountUsd, 'USD', 'ILS');
}

/** Reciprocal of {@link getFxToUsdMultiplier} for `ILS` (dashboard-style). */
export function getUsdToIlsRate(): number {
  return 1 / getFxToUsdMultiplier('ILS');
}

/**
 * ILS per 1 unit of `currency` for a document that has no frozen rate yet
 * (a draft): the latest Bank-of-Israel representative rate loaded into
 * memory (`ensureFreshRateToIls` in `@/lib/fx/usd-ils-rate`), however old.
 *
 * Null when no BOI rate has been loaded for the currency. There is no fixed
 * fallback on purpose: a preview then shows no ILS figures rather than
 * invented ones, and statutory conversions refuse. An issued document
 * carries its own rate (`fx_rate_to_ils`) and never reads this.
 */
export function getKnownRateToIls(currency: string): number | null {
  const cur = currency.toUpperCase();
  if (cur === 'ILS' || cur === 'NIS') return 1;
  return getLatestCachedRateToIls(cur);
}

/**
 * SQL expression: numeric invoice amount column → amount in `displayCurrency`.
 *
 * Converts via USD: amount_in_display = amount_in_src * (src→USD) / (display→USD).
 * Unknown source currencies fall through the ELSE branch as a best-effort raw
 * sum (no multiplier available).
 */
export function sqlAmountInDisplayCurrency(
  amt: SQL,
  displayCurrency: string,
  sourceCurrency: SQLWrapper = invoices.currency,
): SQL {
  const display = displayCurrency.toUpperCase();
  const fxDisplay = getFxToUsdMultiplier(display);

  // Pre-compute source→display factors so the generated SQL contains plain
  // numeric literals (no per-row division by a constant).
  const factor = (src: string) => getFxToUsdMultiplier(src) / fxDisplay;

  const usd = factor('USD');
  const ils = factor('ILS');
  const eur = factor('EUR');
  const gbp = factor('GBP');

  return sql`(
    CASE upper(coalesce(${sourceCurrency}, 'ILS'))
      WHEN 'USD' THEN ${amt} * ${usd}
      WHEN 'ILS' THEN ${amt} * ${ils}
      WHEN 'NIS' THEN ${amt} * ${ils}
      WHEN 'EUR' THEN ${amt} * ${eur}
      WHEN 'GBP' THEN ${amt} * ${gbp}
      ELSE ${amt}
    END
  )`;
}

/**
 * Ensures `amountUsd` is set: prefer LLM value when present, else derive from amount + currency.
 */
export function ensureAmountUsd(data: ExtractedInvoiceData): ExtractedInvoiceData {
  if (data.amount == null) {
    return { ...data, amountUsd: data.amountUsd ?? null };
  }
  const cur = (data.currency ?? 'ILS').toUpperCase();
  if (data.amountUsd != null && Number.isFinite(data.amountUsd)) {
    return data;
  }
  return { ...data, amountUsd: convertAmountToUsd(data.amount, cur) };
}
