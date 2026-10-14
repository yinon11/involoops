import { eq } from "drizzle-orm";
import { db } from "@/db";
import { fxRates } from "@/db/schema/fx-rates";
import { setCachedRateToIls } from "./usd-ils-cache";

/**
 * Load every stored rate (`fx_rates`, quote ILS) into memory, without
 * calling the Bank of Israel. For command-line scripts that convert
 * documents to ILS — the server path (`ensureFreshRateToIls`) is
 * `server-only` and may fetch; this only reads what is already stored.
 */
export async function loadStoredRatesIntoMemory(): Promise<number> {
  const rows = await db.select().from(fxRates).where(eq(fxRates.quote, "ILS"));
  for (const r of rows) {
    setCachedRateToIls(r.base, Number(r.rate), r.fetchedAt, r.publishedAt);
  }
  return rows.length;
}
