/**
 * Currency formatting helpers for invoice display.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: '\u20AA', // ₪
  USD: '$',
  EUR: '\u20AC', // €
  GBP: '\u00A3', // £
};

const CURRENCY_LOCALE: Record<string, string> = {
  ILS: 'he-IL',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
};

/**
 * Get the currency symbol for a given currency code.
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] || currency;
}

/**
 * Format an amount with the appropriate currency symbol.
 * Uses locale-aware formatting for proper number formatting.
 */
export function formatCurrency(amount: number, currency: string): string {
  const upperCurrency = currency.toUpperCase();
  const locale = CURRENCY_LOCALE[upperCurrency] || 'en-US';

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: upperCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback for unknown currency codes
    const symbol = getCurrencySymbol(upperCurrency);
    return `${symbol}${amount.toFixed(2)}`;
  }
}

/**
 * Same formatting as `formatCurrency`, without the cents.
 *
 * Dashboards deal in headline figures where two decimal places are noise —
 * `₪427,279` is read at a glance, `₪427,279.46` is not. It deliberately reuses
 * the same locale table so a summary tile and the table underneath it put the
 * symbol on the same side.
 */
export function formatCurrencyCompact(amount: number, currency: string): string {
  const upperCurrency = (currency || 'ILS').toUpperCase();
  const locale = CURRENCY_LOCALE[upperCurrency] || 'en-US';

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: upperCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${getCurrencySymbol(upperCurrency)}${Math.round(amount).toLocaleString()}`;
  }
}
