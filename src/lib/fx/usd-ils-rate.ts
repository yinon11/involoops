import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { fxRates } from "@/db/schema/fx-rates";
import {
  getFreshCachedRateToIls,
  isRateCurrent,
  setCachedRateToIls,
} from "./usd-ils-cache";

/**
 * Foreign-currency->ILS rates (USD, EUR, GBP) from the Bank of Israel
 * representative rate (שער יציג), cached in the `fx_rates` table. The file
 * keeps its USD name because USD came first; every function takes the
 * currency.
 *
 * - **Cache.** The latest rate per currency is stored with when BOI
 *   published it. Once today's rate is stored, nothing calls BOI again that
 *   day. Before it is published (mornings, weekends, holidays) BOI is asked
 *   again at most hourly (`isRateCurrent`).
 * - **Failure.** If BOI cannot be reached, the latest stored rate is used,
 *   however old — never a fixed value. Only when no rate was ever stored
 *   for the currency is there nothing to use, and then issuing a document
 *   in it fails with {@link FxRateUnavailableError} rather than invent one.
 *
 * The resolved value is mirrored into process memory so the synchronous
 * render helpers (`getKnownRateToIls`) can read it without awaiting.
 */

const QUOTE = "ILS";
const FETCH_TIMEOUT_MS = 8000;

/** Currencies the Bank of Israel publishes a representative rate for that we issue in. */
export const BOI_CURRENCIES = ["USD", "EUR", "GBP"] as const;

interface BoiExchangeRate {
  key?: string;
  currentExchangeRate?: number;
  unit?: number;
  lastUpdate?: string;
}

/** No BOI rate could be fetched and none was ever stored for the currency. */
export class FxRateUnavailableError extends Error {
  constructor(readonly currency: string, cause: unknown) {
    super(
      `The Bank of Israel exchange rate for ${currency} is not available right now and no earlier rate is stored. Try again in a few minutes.`,
    );
    this.name = "FxRateUnavailableError";
    this.cause = cause;
  }
}

/**
 * Fetch the latest published representative rate (שער יציג) for `currency`
 * from the Bank of Israel: ILS per 1 unit, and when BOI published it.
 */
export async function fetchRateToIlsFromBoi(
  currency: string,
): Promise<{ rate: number; publishedAt: Date | null }> {
  const key = currency.toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://boi.org.il/PublicApi/GetExchangeRate?key=${encodeURIComponent(key)}`,
      {
        headers: { accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!res.ok) throw new Error(`BOI HTTP ${res.status}`);
    const data = (await res.json()) as BoiExchangeRate;
    const unit = data.unit && data.unit > 0 ? data.unit : 1;
    const rate = (data.currentExchangeRate ?? 0) / unit;
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`BOI returned invalid ${key} rate: ${data.currentExchangeRate}`);
    }
    const published = data.lastUpdate ? new Date(data.lastUpdate) : null;
    return {
      rate: Math.round(rate * 1_000_000) / 1_000_000,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch today's USD->ILS representative rate from the Bank of Israel. */
export async function fetchUsdToIlsFromBoi(): Promise<number> {
  return (await fetchRateToIlsFromBoi("USD")).rate;
}

async function readRow(currency: string) {
  const [row] = await db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.base, currency), eq(fxRates.quote, QUOTE)))
    .limit(1);
  return row ?? null;
}

export interface ResolvedRate {
  rate: number;
  /**
   * "boi" — the latest rate BOI had published when we asked (cached or just
   * fetched); "boi_stale" — BOI could not be reached and this is the latest
   * stored rate.
   */
  source: "boi" | "boi_stale";
  /** When we last asked BOI. */
  fetchedAt: Date;
  /** When BOI published this rate. */
  publishedAt: Date | null;
}

/**
 * The `currency`->ILS rate to use now. See the module comment for the
 * cache and failure rules. Warms the in-memory cache as a side effect.
 *
 * @throws FxRateUnavailableError when BOI fails and nothing is stored.
 */
export async function resolveRateToIls(currency: string): Promise<ResolvedRate> {
  const cur = currency.toUpperCase();
  const existing = await readRow(cur);

  if (existing && isRateCurrent(existing)) {
    const rate = Number(existing.rate);
    setCachedRateToIls(cur, rate, existing.fetchedAt, existing.publishedAt);
    return {
      rate,
      source: "boi",
      fetchedAt: existing.fetchedAt,
      publishedAt: existing.publishedAt,
    };
  }

  try {
    const { rate, publishedAt } = await fetchRateToIlsFromBoi(cur);
    const now = new Date();
    await db
      .insert(fxRates)
      .values({
        base: cur,
        quote: QUOTE,
        rate: String(rate),
        source: "boi",
        fetchedAt: now,
        publishedAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [fxRates.base, fxRates.quote],
        set: {
          rate: String(rate),
          source: "boi",
          fetchedAt: now,
          publishedAt,
          updatedAt: now,
        },
      });
    setCachedRateToIls(cur, rate, now, publishedAt);
    return { rate, source: "boi", fetchedAt: now, publishedAt };
  } catch (err) {
    console.error(`[fx] BOI ${cur}->ILS fetch failed:`, err);
    if (existing) {
      // The latest stored rate, however old — never a fixed value.
      const rate = Number(existing.rate);
      setCachedRateToIls(cur, rate, existing.fetchedAt, existing.publishedAt);
      return {
        rate,
        source: "boi_stale",
        fetchedAt: existing.fetchedAt,
        publishedAt: existing.publishedAt,
      };
    }
    throw new FxRateUnavailableError(cur, err);
  }
}

/**
 * The USD->ILS rate, or undefined when none can be had. For previews only:
 * a caller that issues a document uses {@link resolveRateToIls}.
 */
export async function getCachedUsdToIlsRate(): Promise<number | undefined> {
  try {
    return (await resolveRateToIls("USD")).rate;
  } catch {
    return undefined;
  }
}

/** Best-effort rates for every issuing currency, for draft previews. */
export async function getPreviewRatesToIls(): Promise<Partial<Record<string, number>>> {
  const entries = await Promise.all(
    BOI_CURRENCIES.map(async (cur) => {
      try {
        return [cur, (await resolveRateToIls(cur)).rate] as const;
      } catch {
        return [cur, undefined] as const;
      }
    }),
  );
  return Object.fromEntries(entries.filter(([, r]) => r !== undefined));
}

/**
 * Load the rate for `currency` into memory if the memory copy is not
 * current. Call before rendering a draft or exporting documents that have
 * no frozen rate, so the synchronous helpers use the stored BOI rate.
 * Never throws; a no-op for ILS.
 */
export async function ensureFreshRateToIls(currency: string | null | undefined): Promise<void> {
  const cur = (currency ?? "ILS").toUpperCase();
  if (cur === "ILS" || cur === "NIS") return;
  if (getFreshCachedRateToIls(cur) != null) return;
  try {
    await resolveRateToIls(cur);
  } catch {
    // Nothing stored and BOI down: the preview falls back; issuing refuses.
  }
}

export async function ensureFreshUsdToIlsRate(): Promise<void> {
  await ensureFreshRateToIls("USD");
}
