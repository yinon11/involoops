import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Locally-cached foreign-exchange rates with a daily refresh.
 *
 * One row per currency pair (USD, EUR, GBP → ILS): the latest Bank of Israel
 * representative rate we have seen. `publishedAt` says which day's rate it
 * is, `fetchedAt` when we last asked. It is the cache — the API is called
 * once today's rate is missing, at most hourly — and the fallback: when BOI
 * is unreachable, the latest row is used, however old. See
 * `src/lib/fx/usd-ils-rate.ts`.
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** ISO-4217 base currency, e.g. "USD". */
    base: varchar({ length: 3 }).notNull(),
    /** ISO-4217 quote currency, e.g. "ILS". `rate` = quote per 1 base. */
    quote: varchar({ length: 3 }).notNull(),
    /** Quote units per 1 base unit (e.g. 3.123456 ILS per 1 USD). */
    rate: numeric({ precision: 18, scale: 6 }).notNull(),
    /** Where the rate came from (e.g. "boi"). */
    source: varchar({ length: 32 }).notNull().default("boi"),
    /** When the rate was last pulled from the source. */
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
    /** When the source published this rate (BOI `lastUpdate`). Migration 0048. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("fx_rates_base_quote_unique").on(t.base, t.quote)],
);

export type FxRateRow = typeof fxRates.$inferSelect;
