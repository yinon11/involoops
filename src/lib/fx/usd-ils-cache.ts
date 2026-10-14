/**
 * Process-memory mirror of the foreign-currency → ILS rates in `fx_rates`,
 * plus the rule for when a cached rate is still current.
 *
 * The document render helpers (`getKnownRateToIls` in `@/lib/fx`) are
 * synchronous and used deep inside pure functions, so they can't `await` a
 * DB read; this holds the latest rate per currency once something has
 * loaded it (`ensureFreshRateToIls`). It is intentionally pure (no DB / no
 * `server-only`) so it is safe to import from anywhere.
 *
 * Named for USD, its first currency; it holds any.
 */

/** How often to ask BOI again while today's rate has not been published. */
export const RATE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

interface CachedRate {
  rate: number;
  /** When we last asked the source. */
  fetchedAt: Date;
  /** When the source published this rate (BOI `lastUpdate`), if known. */
  publishedAt: Date | null;
}

// Survive module re-evaluation (HMR / multiple bundles) via globalThis.
const store = globalThis as unknown as {
  __fxIlsRateCache?: Map<string, CachedRate>;
};

function cache(): Map<string, CachedRate> {
  store.__fxIlsRateCache ??= new Map();
  return store.__fxIlsRateCache;
}

/** Calendar day in Israel time — the cadence at which BOI publishes. */
function jerusalemDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** True when `at` falls on today's Israel calendar day. */
export function isPulledToday(at: Date): boolean {
  return jerusalemDay(at) === jerusalemDay(new Date());
}

/**
 * Whether a cached rate can be used without asking the source again.
 *
 * Current once today's rate is in hand: BOI publishes once a business day,
 * so a rate published today is final for the day. Before that — a morning
 * before publication, a weekend, a holiday — the latest published rate is
 * the right one to use, but today's may appear any time, so it is asked
 * for again at most once per {@link RATE_REFRESH_INTERVAL_MS}.
 */
export function isRateCurrent(
  entry: { fetchedAt: Date; publishedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (entry.publishedAt && jerusalemDay(entry.publishedAt) === jerusalemDay(now)) {
    return true;
  }
  return now.getTime() - entry.fetchedAt.getTime() < RATE_REFRESH_INTERVAL_MS;
}

export function setCachedRateToIls(
  currency: string,
  rate: number,
  fetchedAt: Date,
  publishedAt: Date | null = null,
): void {
  cache().set(currency.toUpperCase(), { rate, fetchedAt, publishedAt });
}

/** The latest rate loaded for `currency`, however old; null if none. */
export function getLatestCachedRateToIls(currency: string): number | null {
  return cache().get(currency.toUpperCase())?.rate ?? null;
}

/** The cached rate for `currency` only while it is current; else null. */
export function getFreshCachedRateToIls(currency: string): number | null {
  const c = cache().get(currency.toUpperCase());
  return c && isRateCurrent(c) ? c.rate : null;
}

export function setCachedUsdToIls(rate: number, fetchedAt: Date): void {
  setCachedRateToIls("USD", rate, fetchedAt);
}

/** The latest USD rate loaded, however old; null if none. */
export function getFreshCachedUsdToIls(): number | null {
  return getLatestCachedRateToIls("USD");
}
