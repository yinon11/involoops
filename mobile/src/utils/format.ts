import type { Locale } from "@/constants/copy";

function intlLocale(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-US";
}

export function formatMoney(amount: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

/** Short money for chart labels: ₪12K instead of ₪12,340. */
export function formatMoneyCompact(amount: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return formatMoney(amount, currency, locale);
  }
}

/** "2026-03" → "Mar" / "מרץ". */
export function formatMonthShort(month: string, locale: Locale): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { month: "short" }).format(
      new Date(year, monthNumber - 1, 1),
    );
  } catch {
    return month;
  }
}

/** "2026-03" → "March 2026" / "מרץ 2026". */
export function formatMonthLong(month: string, locale: Locale): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric" }).format(
      new Date(year, monthNumber - 1, 1),
    );
  } catch {
    return month;
  }
}

/** Signed percent change, or null when there is no base to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
