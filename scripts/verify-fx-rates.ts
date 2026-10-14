/**
 * Verification harness for the Bank of Israel rate cache
 * (`src/lib/fx/usd-ils-rate.ts`).
 *
 * Run: `DATABASE_URL=... NODE_OPTIONS="--require ./scripts/stub-server-only.cjs" npx tsx scripts/verify-fx-rates.ts`
 *
 * The rules under test:
 * - once today's published rate is stored, BOI is not called again that day;
 * - before it is published, BOI is asked again at most hourly;
 * - when BOI fails, the latest stored rate is used, however old — never a
 *   fixed value;
 * - with nothing ever stored and BOI down, it refuses rather than invent one.
 *
 * `fetch` is stubbed, so BOI is never contacted. Uses made-up currency codes
 * (XTA, XTB, XTC) so real cached rates are untouched, and removes them after.
 */

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { fxRates } from "@/db/schema/fx-rates";
import {
  FxRateUnavailableError,
  resolveRateToIls,
} from "@/lib/fx/usd-ils-rate";
import { getKnownRateToIls } from "@/lib/fx";
import { buildForeignExchangeDisplay } from "@/lib/outbound/foreign-exchange-display";
import { MissingExchangeRateError, toStatutoryIlsAmounts } from "@/lib/outbound/statutory-ils-amounts";

const CODES = ["XTA", "XTB", "XTC"];
type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// --- a controllable BOI ------------------------------------------------------
let calls = 0;
let boi: { rate: number; lastUpdate: string } | "down" = "down";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  if (!String(url).includes("boi.org.il")) return realFetch(url as never);
  calls++;
  if (boi === "down") throw new Error("simulated BOI outage");
  return new Response(
    JSON.stringify({ key: "X", currentExchangeRate: boi.rate, unit: 1, lastUpdate: boi.lastUpdate }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;

const HOUR = 3_600_000;
const now = () => new Date();
const yesterday = () => new Date(Date.now() - 26 * HOUR).toISOString();

async function setRow(code: string, rate: number, fetchedAgoMs: number, publishedAt: Date | null) {
  const fetchedAt = new Date(Date.now() - fetchedAgoMs);
  await db.insert(fxRates)
    .values({ base: code, quote: "ILS", rate: String(rate), source: "boi", fetchedAt, publishedAt, updatedAt: fetchedAt })
    .onConflictDoUpdate({ target: [fxRates.base, fxRates.quote], set: { rate: String(rate), fetchedAt, publishedAt } });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[verify-fx-rates] DATABASE_URL is not set.");
    process.exit(1);
  }
  await db.delete(fxRates).where(inArray(fxRates.base, CODES));
  try {
    // 1. Nothing stored: one call, stored with its publication time.
    boi = { rate: 3.5, lastUpdate: now().toISOString() };
    calls = 0;
    const first = await resolveRateToIls("XTA");
    const [row] = await db.select().from(fxRates).where(inArray(fxRates.base, ["XTA"]));
    record("1. first use calls BOI once and stores the rate with when it was published",
      calls === 1 && first.rate === 3.5 && first.source === "boi" && Number(row?.rate) === 3.5 && row?.publishedAt != null,
      `calls=${calls} stored=${row?.rate} published=${row?.publishedAt?.toISOString()}`);

    // 2. Today's rate stored: no more calls that day.
    calls = 0;
    await resolveRateToIls("XTA");
    await resolveRateToIls("XTA");
    record("2. today's rate in the DB → no API call", calls === 0, `calls=${calls}`);

    // 3. Stored rate is yesterday's, asked 2h ago (a morning before publication): ask again.
    await setRow("XTB", 3.6, 2 * HOUR, new Date(yesterday()));
    boi = { rate: 3.7, lastUpdate: now().toISOString() };
    calls = 0;
    const refreshed = await resolveRateToIls("XTB");
    record("3. yesterday's rate, last asked over an hour ago → asks again and takes today's",
      calls === 1 && refreshed.rate === 3.7, `calls=${calls} rate=${refreshed.rate}`);

    // 4. Yesterday's rate, asked 10 min ago (weekend / not yet published): no call.
    await setRow("XTB", 3.6, 10 * 60_000, new Date(yesterday()));
    calls = 0;
    const throttled = await resolveRateToIls("XTB");
    record("4. yesterday's rate, last asked 10 minutes ago → no call, uses it (at most hourly)",
      calls === 0 && throttled.rate === 3.6 && throttled.source === "boi", `calls=${calls} rate=${throttled.rate}`);

    // 5. BOI down: the latest stored rate, however old — never a fixed value.
    await setRow("XTB", 3.65, 30 * 24 * HOUR, new Date(Date.now() - 30 * 24 * HOUR));
    boi = "down";
    calls = 0;
    const stale = await resolveRateToIls("XTB");
    record("5. BOI down → the latest stored rate (a month old here), flagged boi_stale",
      calls === 1 && stale.rate === 3.65 && stale.source === "boi_stale", `rate=${stale.rate} source=${stale.source}`);
    record("6. the in-memory rate used by previews/exports is that stored rate, not a fixed one",
      getKnownRateToIls("XTB") === 3.65, `known=${getKnownRateToIls("XTB")}`);

    // 7. Nothing ever stored and BOI down: refuse.
    let refused = false;
    try {
      await resolveRateToIls("XTC");
    } catch (e) {
      refused = e instanceof FxRateUnavailableError;
    }
    record("7. nothing ever stored + BOI down → refuses (issuing fails), no invented rate", refused);

    // 8. And with no rate known, nothing shows or converts at an invented one.
    const preview = buildForeignExchangeDisplay({ currency: "XTC", subtotal: 100, vatAmount: 18, total: 118 });
    let conversionRefused = false;
    try {
      toStatutoryIlsAmounts({ currency: "XTC", subtotal: 100, vatAmount: 18, total: 118 });
    } catch (e) {
      conversionRefused = e instanceof MissingExchangeRateError;
    }
    record("8. no rate known → preview shows no ILS figures, statutory conversion refuses (no fixed fallback)",
      preview === null && conversionRefused && getKnownRateToIls("XTC") === null,
      `preview=${preview === null ? "none" : "shown!"} refused=${conversionRefused}`);
  } finally {
    await db.delete(fxRates).where(inArray(fxRates.base, CODES));
    globalThis.fetch = realFetch;
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[verify-fx-rates] ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

void main();
