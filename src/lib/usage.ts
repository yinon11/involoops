import { db } from "@/db";
import { usageTracking } from "@/db/schema/usage-tracking";
import { and, eq, sql } from "drizzle-orm";
import { resolveEffectiveTier } from "@/lib/effective-tier";

function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export interface UsageInfo {
  allowed: boolean;
  current: number;
  limit: number;
  planName: string;
  planCode: string;
  /** True when the user is uploading on their own Anthropic key. */
  byok: boolean;
}

/**
 * Check if user can upload more invoices this month.
 *
 * The tier decision is delegated to `resolveEffectiveTier`, which always
 * re-derives from the database — there is no persisted "enterprise
 * entitlement" flag for BYOK users, so removing the key instantly drops
 * them back to their real subscription tier. The monthly invoice counter
 * (`usage_tracking`) is untouched by tier changes, which also prevents a
 * "set key → consume 400 BYOK invoices → remove key → keep them as paid"
 * exploit: the counter is the same counter, and the new (lower) limit is
 * enforced against the full month-to-date count.
 */
export async function checkUsageLimit(userId: string): Promise<UsageInfo> {
  const tier = await resolveEffectiveTier(userId);

  const yearMonth = getCurrentYearMonth();
  const usage = await db.query.usageTracking.findFirst({
    where: and(
      eq(usageTracking.userId, userId),
      eq(usageTracking.yearMonth, yearMonth)
    ),
  });

  const current = usage?.invoiceCount ?? 0;

  return {
    allowed: current < tier.maxInvoices,
    current,
    limit: tier.maxInvoices,
    planName: tier.tierName,
    planCode: tier.tierCode,
    byok: tier.byok,
  };
}

/**
 * Atomically reserve `count` invoice-handling slots for this month in a
 * single SQL statement. Returns `true` when the reservation succeeded
 * (counter advanced by `count`), `false` when it would push the user
 * over `limit` and is therefore refused.
 *
 * Semantics — the counter is a "handling meter", not a row count:
 *   - Every attempted invoice handle takes one slot: initial uploads,
 *     each file inside a ZIP, re-extractions, regenerations.
 *   - Duplicates and extraction failures still count, because the work
 *     (S3 download, LLM call, etc.) was actually performed.
 *   - The counter is **monotonic** — it never decreases. There is no
 *     release: if you reserved a slot and then chose not to use it, the
 *     slot stays consumed. Deleting an invoice does not refund a slot.
 *
 * Concurrency — Postgres holds a row lock inside ON CONFLICT DO UPDATE
 * on the unique (user_id, year_month) row, so concurrent reservations
 * (e.g. two browser tabs, an email arriving mid-upload) serialise on
 * the same row and the counter cannot exceed `limit` even under
 * parallel writers across processes.
 *
 * Use the singular wrapper `tryReserveInvoiceSlot` for one-at-a-time
 * paths. Use this batch form for ZIP uploads, where the policy is
 * all-or-nothing: if the whole batch fits, all N slots are reserved
 * atomically; otherwise nothing is consumed and the caller can refuse
 * the whole archive up-front instead of partially processing it.
 */
export async function tryReserveInvoiceSlots(
  userId: string,
  count: number,
  limit: number
): Promise<boolean> {
  if (count <= 0) return true;
  // A batch larger than the plan limit can never fit in any one month;
  // fail fast without touching the row.
  if (count > limit) return false;

  const yearMonth = getCurrentYearMonth();

  // Two cases handled in one statement:
  //   1. No row yet for this user-month → INSERT with invoice_count = N.
  //      We pre-checked `N <= limit` above, so this is safe.
  //   2. Row exists → ON CONFLICT path adds N, but only when the result
  //      stays within the cap; otherwise the WHERE makes Postgres skip
  //      the update and RETURNING comes back empty.
  const rows = await db.execute<{ invoice_count: number }>(sql`
    INSERT INTO usage_tracking (user_id, year_month, invoice_count, updated_at)
    VALUES (${userId}, ${yearMonth}, ${count}, NOW())
    ON CONFLICT (user_id, year_month)
    DO UPDATE SET
      invoice_count = usage_tracking.invoice_count + ${count},
      updated_at = NOW()
    WHERE usage_tracking.invoice_count + ${count} <= ${limit}
    RETURNING invoice_count
  `);

  return rows.length > 0;
}

/**
 * Atomically reserve a single invoice-handling slot. Thin wrapper
 * around `tryReserveInvoiceSlots(userId, 1, limit)` for the common
 * one-file-at-a-time paths.
 */
export async function tryReserveInvoiceSlot(
  userId: string,
  limit: number
): Promise<boolean> {
  return tryReserveInvoiceSlots(userId, 1, limit);
}

/**
 * Get current month usage for display.
 */
export async function getCurrentMonthUsage(
  userId: string
): Promise<{ count: number; yearMonth: string }> {
  const yearMonth = getCurrentYearMonth();
  const usage = await db.query.usageTracking.findFirst({
    where: and(
      eq(usageTracking.userId, userId),
      eq(usageTracking.yearMonth, yearMonth)
    ),
  });

  return { count: usage?.invoiceCount ?? 0, yearMonth };
}
