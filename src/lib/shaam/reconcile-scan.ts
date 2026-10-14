/**
 * Which documents the reconciliation cron should pick up, and when.
 *
 * Extracted from the route so it can be exercised against a real database
 * by `scripts/verify-shaam-reconcile.ts` — the predicate below is pure SQL
 * composition, which is exactly the kind of thing that looks right and
 * silently matches the wrong rows.
 */

import { and, eq, gte, inArray, lt, or } from "drizzle-orm";
import { outboundInvoices } from "@/db/schema";

export const ELIGIBILITY_AGE_MS = 5 * 60 * 1000;

/**
 * Transient trouble — PENDING or OUTAGE_ISSUED. Something on the wire or
 * on our side went wrong, so chase hard and then give up: roughly nine
 * hours across the ladder, after which the document is retired for manual
 * reconciliation.
 */
export const MAX_RETRIES = 10;
export const TRANSIENT_BACKOFF_SECONDS = [
  30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400,
];

/**
 * HELD is a different animal and used to be left out of this scan
 * entirely, which meant a document the ITA said "not decided yet" about
 * was never asked again — if they approved it a day later, nobody found
 * out. Re-submitting is the only channel we have for asking, so HELD is
 * now polled too, on a much slower ladder: this is a human decision at
 * the ITA (a שימוע), not a failed request, so hammering it is pointless
 * and rude, but hours-to-days patience is exactly right.
 *
 * Deliberately keeps polling past `shaam_hearing_deadline`. Where that
 * window closes without a decision the request can end up granted by
 * default, so the period just after the deadline is the *most* likely
 * time for an approval to appear — stopping there would miss the thing
 * we are waiting for.
 */
export const HELD_BACKOFF_SECONDS = [
  3600, 3600, 7200, 14400, 21600, 43200, 86400,
];
/** Past this we stop asking. Covers the 30-day השגה window with slack. */
export const HELD_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Batch ceiling and wall-clock budget. The ceiling is a safety valve, not
 * a throughput target: the scan below only returns documents that are
 * actually due, so a run normally drains everything and reports
 * `backlog.remaining = 0`. Set `SHAAM_RETRY_BATCH_SIZE=0` to remove the
 * ceiling entirely. Either way the response says how many documents were
 * eligible, so a backlog is visible rather than silent.
 */
export const DEFAULT_BATCH_LIMIT = 500;
export const DEFAULT_RUN_BUDGET_MS = 60_000;

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * "Enough time has passed since the last attempt", as SQL.
 *
 * This used to be a JS check *inside* the loop, after `limit(100)` had
 * already been applied — so a hundred documents sitting in backoff could
 * fill the window and starve the ones that were actually due, with no
 * ORDER BY to make it fair. Pushing the gate into the WHERE clause means
 * every row the scan returns is ready to submit.
 */
export function dueOnLadder(
  ladder: readonly number[],
  nowMs: number,
  /** Which counter paces this ladder — retries for failures, polls for holds. */
  counter:
    | typeof outboundInvoices.shaamRetryCount
    | typeof outboundInvoices.shaamHoldPollCount,
) {
  const rungs = ladder.map((seconds, index) =>
    and(
      eq(counter, index),
      lt(
        outboundInvoices.shaamSubmittedAt,
        new Date(nowMs - seconds * 1000),
      ),
    ),
  );
  // Counts at or beyond the end of the ladder stay on its last rung.
  const last = ladder[ladder.length - 1];
  rungs.push(
    and(
      gte(counter, ladder.length),
      lt(outboundInvoices.shaamSubmittedAt, new Date(nowMs - last * 1000)),
    ),
  );
  return or(...rungs);
}


/**
 * The full scan predicate: a global floor on submission age, then either
 * the transient ladder (still within MAX_RETRIES) or the hold ladder
 * (still inside HELD_MAX_AGE_MS).
 */
export function buildReconcileScanWhere(nowMs: number) {
  return and(
    // Floor for every status: never grab a submission that is seconds old.
    lt(
      outboundInvoices.shaamSubmittedAt,
      new Date(nowMs - ELIGIBILITY_AGE_MS),
    ),
    or(
      and(
        inArray(outboundInvoices.shaamStatus, ["PENDING", "OUTAGE_ISSUED"]),
        lt(outboundInvoices.shaamRetryCount, MAX_RETRIES),
        dueOnLadder(
          TRANSIENT_BACKOFF_SECONDS,
          nowMs,
          outboundInvoices.shaamRetryCount,
        ),
      ),
      and(
        eq(outboundInvoices.shaamStatus, "HELD"),
        gte(
          outboundInvoices.shaamSubmittedAt,
          new Date(nowMs - HELD_MAX_AGE_MS),
        ),
        dueOnLadder(
          HELD_BACKOFF_SECONDS,
          nowMs,
          outboundInvoices.shaamHoldPollCount,
        ),
      ),
    ),
  );
}
