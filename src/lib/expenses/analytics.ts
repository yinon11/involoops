/**
 * UserId-scoped expense / income / profit analytics for MCP (and eventually
 * REST). Mirrors the aggregations in
 * `src/features/expenses/actions/invoice-actions.ts` without session auth.
 */

import { db } from "@/db";
import { invoices, vendors } from "@/db/schema";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  sql,
} from "drizzle-orm";
import { sqlAmountInDisplayCurrency } from "@/lib/fx";
import { getUserDisplayCurrency } from "@/lib/display-currency";
import { incomeCoveredByIssuedDocument } from "@/lib/outbound/income-mirror";
import { sumIssuedIncome } from "@/lib/outbound/revenue";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";

export type AnalyticsTimeRange = "allTime" | "last12Months" | "year";

export interface AnalyticsPeriodFilters {
  timeRange?: AnalyticsTimeRange;
  year?: number;
  months?: number[];
  dateFrom?: string;
  dateTo?: string;
  vendorIds?: string[];
  showWithoutVat?: boolean;
}

export interface VendorSpendRow {
  vendor_id: string | null;
  vendor_name: string;
  total: number;
  share_pct: number;
  invoice_count?: number;
}

function getDisplayCurrencyForUser(userId: string): Promise<string> {
  return getUserDisplayCurrency(userId);
}

function last12MonthsStartDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d.toISOString().split("T")[0];
}

function amountSumExpr(showWithoutVat: boolean) {
  return showWithoutVat
    ? sql`coalesce(${invoices.amountWithoutVat}::numeric, ${invoices.amount}::numeric)`
    : sql`${invoices.amount}::numeric`;
}

function shouldGroupTrendByDay(filters: AnalyticsPeriodFilters): boolean {
  const TWO_MONTHS_DAYS = 62;
  const MS_PER_DAY = 86_400_000;
  if (filters.dateFrom && filters.dateTo) {
    const span =
      (new Date(filters.dateTo).getTime() -
        new Date(filters.dateFrom).getTime()) /
      MS_PER_DAY;
    return span < TWO_MONTHS_DAYS;
  }
  if (filters.dateFrom) {
    const span =
      (Date.now() - new Date(filters.dateFrom).getTime()) / MS_PER_DAY;
    return span < TWO_MONTHS_DAYS;
  }
  if (filters.year && filters.months && filters.months.length > 0) {
    return filters.months.length < 2;
  }
  return false;
}

function pushPeriodConditions(
  conditions: SqlCondition[],
  filters: AnalyticsPeriodFilters,
): void {
  if (filters.timeRange === "last12Months") {
    conditions.push(gte(invoices.invoiceDate, last12MonthsStartDate()));
  }
  if (filters.year) {
    conditions.push(
      sql`extract(year from ${invoices.invoiceDate}::date) = ${filters.year}`,
    );
  }
  if (filters.months && filters.months.length > 0) {
    conditions.push(
      inArray(
        sql<number>`extract(month from ${invoices.invoiceDate}::date)::int`,
        filters.months,
      ),
    );
  }
  if (filters.dateFrom) {
    conditions.push(gte(invoices.invoiceDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(invoices.invoiceDate, filters.dateTo));
  }
  if (filters.vendorIds && filters.vendorIds.length > 0) {
    conditions.push(inArray(invoices.vendorId, filters.vendorIds));
  }
}

function withShares(
  rows: { vendorId: string | null; vendorName: string; total: number }[],
  grandTotal: number,
): VendorSpendRow[] {
  return rows.map((row) => ({
    vendor_id: row.vendorId,
    vendor_name: row.vendorName,
    total: row.total,
    share_pct:
      grandTotal > 0
        ? Math.round((row.total / grandTotal) * 1000) / 10
        : 0,
  }));
}

/** Expense dashboard KPIs + vendor split + trend (approved expenses). */
export async function getExpenseDashboardOp(
  userId: string,
  filters: AnalyticsPeriodFilters = {},
) {
  const currency = await getDisplayCurrencyForUser(userId);
  const showWithoutVat = filters.showWithoutVat ?? false;
  const amt = amountSumExpr(showWithoutVat);
  const displayAmt = sqlAmountInDisplayCurrency(amt, currency);

  const baseConditions: SqlCondition[] = [
    eq(invoices.userId, userId),
    eq(invoices.status, "approved"),
    eq(invoices.type, "expense"),
  ];
  pushPeriodConditions(baseConditions, filters);

  const [totalResult] = await db
    .select({
      totalSpent: sql<string>`coalesce(sum(${displayAmt}), 0)`,
      invoiceCount: count(invoices.id),
    })
    .from(invoices)
    .where(and(...baseConditions));

  const totalSpent = parseFloat(totalResult.totalSpent);
  const invoiceCount = totalResult.invoiceCount;

  const [vendorCountResult] = await db
    .select({
      vendorCount:
        sql<number>`count(distinct ${invoices.vendorId})`.mapWith(Number),
    })
    .from(invoices)
    .where(and(...baseConditions));

  const groupTrendByDay = shouldGroupTrendByDay(filters);
  const trendGranularity: "day" | "month" = groupTrendByDay ? "day" : "month";
  const trendBucketSql = groupTrendByDay
    ? sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM-DD')`
    : sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`;

  const bucketTotals = await db
    .select({
      bucket: trendBucketSql,
      total: sql<string>`sum(${displayAmt})`,
    })
    .from(invoices)
    .where(and(...baseConditions))
    .groupBy(trendBucketSql)
    .orderBy(trendBucketSql);

  const monthlyAverageRows = groupTrendByDay
    ? await db
        .select({
          month: sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`,
          total: sql<string>`sum(${displayAmt})`,
        })
        .from(invoices)
        .where(and(...baseConditions))
        .groupBy(sql`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`)
    : bucketTotals.map((row) => ({ month: row.bucket, total: row.total }));

  const monthlyAverage =
    monthlyAverageRows.length > 0
      ? monthlyAverageRows.reduce((sum, m) => sum + parseFloat(m.total), 0) /
        monthlyAverageRows.length
      : 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const burnConditions: SqlCondition[] = [
    eq(invoices.userId, userId),
    eq(invoices.status, "approved"),
    eq(invoices.type, "expense"),
    gte(invoices.invoiceDate, thirtyDaysAgo.toISOString().split("T")[0]),
  ];
  if (filters.vendorIds?.length) {
    burnConditions.push(inArray(invoices.vendorId, filters.vendorIds));
  }
  const [burnResult] = await db
    .select({ total: sql<string>`coalesce(sum(${displayAmt}), 0)` })
    .from(invoices)
    .where(and(...burnConditions));

  const vendorBreakdownRows = await db
    .select({
      vendorId: invoices.vendorId,
      vendorName: sql<string>`coalesce(${vendors.name}, 'Unknown')`,
      total: sql<string>`sum(${displayAmt})`,
      invoiceCount: count(invoices.id),
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
    )
    .where(and(...baseConditions))
    .groupBy(invoices.vendorId, vendors.name)
    .orderBy(sql`sum(${displayAmt}) desc`);

  const vendorBreakdown = withShares(
    vendorBreakdownRows.map((row) => ({
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      total: parseFloat(row.total),
    })),
    totalSpent,
  ).map((row, i) => ({
    ...row,
    invoice_count: vendorBreakdownRows[i]!.invoiceCount,
  }));

  return {
    object: "expense_dashboard" as const,
    currency,
    period: normalizePeriod(filters),
    total_spent: totalSpent,
    monthly_average: Math.round(monthlyAverage * 100) / 100,
    thirty_day_burn_rate: parseFloat(burnResult.total),
    vendor_count: vendorCountResult.vendorCount,
    invoice_count: invoiceCount,
    trend_granularity: trendGranularity,
    trend_buckets: bucketTotals.map((row) => ({
      bucket: row.bucket,
      total: parseFloat(row.total),
    })),
    spend_by_vendor: vendorBreakdown,
  };
}

/** Income KPIs + client split (approved income). */
export async function getIncomeDashboardOp(
  userId: string,
  filters: AnalyticsPeriodFilters = {},
) {
  const currency = await getDisplayCurrencyForUser(userId);
  const showWithoutVat = filters.showWithoutVat ?? false;
  const amt = amountSumExpr(showWithoutVat);
  const displayAmt = sqlAmountInDisplayCurrency(amt, currency);

  const baseConditions: SqlCondition[] = [
    eq(invoices.userId, userId),
    eq(invoices.status, "approved"),
    eq(invoices.type, "income"),
    isNull(invoices.outboundInvoiceId),
  ];
  pushPeriodConditions(baseConditions, filters);

  const [totalResult] = await db
    .select({
      totalEarned: sql<string>`coalesce(sum(${displayAmt}), 0)`,
      invoiceCount: count(invoices.id),
    })
    .from(invoices)
    .where(and(...baseConditions));

  const totalEarned = parseFloat(totalResult.totalEarned);

  const [clientCountResult] = await db
    .select({
      clientCount:
        sql<number>`count(distinct ${invoices.vendorId})`.mapWith(Number),
    })
    .from(invoices)
    .where(and(...baseConditions));

  const groupTrendByDay = shouldGroupTrendByDay(filters);
  const trendGranularity: "day" | "month" = groupTrendByDay ? "day" : "month";
  const trendBucketSql = groupTrendByDay
    ? sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM-DD')`
    : sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`;

  const bucketTotals = await db
    .select({
      bucket: trendBucketSql,
      total: sql<string>`sum(${displayAmt})`,
    })
    .from(invoices)
    .where(and(...baseConditions))
    .groupBy(trendBucketSql)
    .orderBy(trendBucketSql);

  const monthlyAverageRows = groupTrendByDay
    ? await db
        .select({
          month: sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`,
          total: sql<string>`sum(${displayAmt})`,
        })
        .from(invoices)
        .where(and(...baseConditions))
        .groupBy(sql`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`)
    : bucketTotals.map((row) => ({ month: row.bucket, total: row.total }));

  const monthlyAverage =
    monthlyAverageRows.length > 0
      ? monthlyAverageRows.reduce((sum, m) => sum + parseFloat(m.total), 0) /
        monthlyAverageRows.length
      : 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const runRateConditions: SqlCondition[] = [
    eq(invoices.userId, userId),
    eq(invoices.status, "approved"),
    eq(invoices.type, "income"),
    isNull(invoices.outboundInvoiceId),
    gte(invoices.invoiceDate, thirtyDaysAgo.toISOString().split("T")[0]),
  ];
  if (filters.vendorIds?.length) {
    runRateConditions.push(inArray(invoices.vendorId, filters.vendorIds));
  }
  const [runRateResult] = await db
    .select({ total: sql<string>`coalesce(sum(${displayAmt}), 0)` })
    .from(invoices)
    .where(and(...runRateConditions));

  const clientRows = await db
    .select({
      vendorId: invoices.vendorId,
      vendorName: sql<string>`coalesce(${vendors.name}, 'Unknown')`,
      total: sql<string>`sum(${displayAmt})`,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
    )
    .where(and(...baseConditions))
    .groupBy(invoices.vendorId, vendors.name)
    .orderBy(sql`sum(${displayAmt}) desc`);

  return {
    object: "income_dashboard" as const,
    currency,
    period: normalizePeriod(filters),
    total_earned: totalEarned,
    monthly_average: Math.round(monthlyAverage * 100) / 100,
    thirty_day_run_rate: parseFloat(runRateResult.total),
    client_count: clientCountResult.clientCount,
    invoice_count: totalResult.invoiceCount,
    trend_granularity: trendGranularity,
    trend_buckets: bucketTotals.map((row) => ({
      bucket: row.bucket,
      total: parseFloat(row.total),
    })),
    earned_by_client: withShares(
      clientRows.map((row) => ({
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        total: parseFloat(row.total),
      })),
      totalEarned,
    ),
  };
}

/** Profit & loss summary for the period. */
export async function getProfitSummaryOp(
  userId: string,
  filters: AnalyticsPeriodFilters = {},
) {
  const currency = await getDisplayCurrencyForUser(userId);
  const conditions: SqlCondition[] = [
    eq(invoices.userId, userId),
    eq(invoices.status, "approved"),
    // Issued documents are added again below via sumIssuedIncome.
    // An upload of the same number is that sale too, so it stays out.
    isNull(invoices.outboundInvoiceId),
    sql`NOT (${incomeCoveredByIssuedDocument})`,
  ];
  pushPeriodConditions(conditions, {
    ...filters,
    vendorIds: undefined, // P&L is business-wide
  });

  const displayAmt = sqlAmountInDisplayCurrency(
    sql`${invoices.amount}::numeric`,
    currency,
  );

  const typeTotals = await db
    .select({
      type: invoices.type,
      total: sql<string>`coalesce(sum(${displayAmt}), 0)`,
      invoiceCount: count(invoices.id),
    })
    .from(invoices)
    .where(and(...conditions))
    .groupBy(invoices.type);

  let totalIncome = 0;
  let totalExpense = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  for (const row of typeTotals) {
    const value = parseFloat(row.total);
    if (row.type === "income") {
      totalIncome = value;
      incomeCount = row.invoiceCount;
    } else if (row.type === "expense") {
      totalExpense = value;
      expenseCount = row.invoiceCount;
    }
  }

  const entity = await getBusinessEntityForUserOrNull(userId);
  const issued = entity
    ? await sumIssuedIncome(entity.id, currency, filters)
    : { total: 0, documentCount: 0, byMonth: [] };
  totalIncome += issued.total;
  incomeCount += issued.documentCount;

  const netProfit = totalIncome - totalExpense;
  const profitMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

  const monthBucketSql = sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`;
  const monthlyRows = await db
    .select({
      month: monthBucketSql,
      type: invoices.type,
      total: sql<string>`coalesce(sum(${displayAmt}), 0)`,
    })
    .from(invoices)
    .where(and(...conditions))
    .groupBy(monthBucketSql, invoices.type)
    .orderBy(monthBucketSql);

  const monthlyMap = new Map<string, { income: number; expense: number }>();
  for (const row of monthlyRows) {
    const bucket = monthlyMap.get(row.month) ?? { income: 0, expense: 0 };
    const v = parseFloat(row.total);
    if (row.type === "income") bucket.income = v;
    else if (row.type === "expense") bucket.expense = v;
    monthlyMap.set(row.month, bucket);
  }
  for (const row of issued.byMonth) {
    if (row.total === 0) continue;
    const bucket = monthlyMap.get(row.month) ?? { income: 0, expense: 0 };
    bucket.income += row.total;
    monthlyMap.set(row.month, bucket);
  }

  const monthlyBreakdown = Array.from(monthlyMap.entries())
    .map(([month, { income, expense }]) => ({
      month,
      income,
      expense,
      profit: income - expense,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const monthsWithActivity = monthlyBreakdown.length;
  const avgMonthlyProfit =
    monthsWithActivity > 0 ? netProfit / monthsWithActivity : 0;
  const bestMonth =
    monthlyBreakdown.length > 0
      ? monthlyBreakdown.reduce((best, m) =>
          m.profit > best.profit ? m : best,
        )
      : null;
  const worstMonth =
    monthlyBreakdown.length > 0
      ? monthlyBreakdown.reduce((worst, m) =>
          m.profit < worst.profit ? m : worst,
        )
      : null;

  return {
    object: "profit_summary" as const,
    currency,
    period: normalizePeriod(filters),
    total_income: totalIncome,
    total_expense: totalExpense,
    net_profit: netProfit,
    profit_margin_pct: Math.round(profitMargin * 10) / 10,
    income_invoice_count: incomeCount,
    expense_invoice_count: expenseCount,
    avg_monthly_profit: Math.round(avgMonthlyProfit * 100) / 100,
    profitable_months: monthlyBreakdown.filter((m) => m.profit > 0).length,
    loss_months: monthlyBreakdown.filter((m) => m.profit < 0).length,
    months_with_activity: monthsWithActivity,
    best_month: bestMonth,
    worst_month: worstMonth,
    monthly_breakdown: monthlyBreakdown,
  };
}

export interface InboundListFilters {
  status?: "processing" | "pending" | "approved" | "rejected";
  type?: "expense" | "income";
  vendorId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  unlinkedVendorOnly?: boolean;
  /** When true, only marked sent to accountant; when false, only not sent. */
  sentToAccountant?: boolean;
}

/** List inbound (expense/income) invoices for drill-down. */
export async function listInboundInvoicesOp(
  userId: string,
  filters: InboundListFilters = {},
) {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const conditions: SqlCondition[] = [eq(invoices.userId, userId)];
  if (filters.status) conditions.push(eq(invoices.status, filters.status));
  if (filters.type) conditions.push(eq(invoices.type, filters.type));
  if (filters.unlinkedVendorOnly) {
    conditions.push(isNull(invoices.vendorId));
  } else if (filters.vendorId) {
    conditions.push(eq(invoices.vendorId, filters.vendorId));
  }
  if (filters.dateFrom) {
    conditions.push(gte(invoices.invoiceDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(invoices.invoiceDate, filters.dateTo));
  }
  if (filters.search) {
    conditions.push(like(invoices.invoiceNumber, `%${filters.search}%`));
  }
  if (filters.sentToAccountant === true) {
    conditions.push(isNotNull(invoices.sentToAccountantAt));
  } else if (filters.sentToAccountant === false) {
    conditions.push(isNull(invoices.sentToAccountantAt));
  }

  const rows = await db
    .select({
      id: invoices.id,
      type: invoices.type,
      status: invoices.status,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      amount: invoices.amount,
      currency: invoices.currency,
      vatAmount: invoices.vatAmount,
      amountWithoutVat: invoices.amountWithoutVat,
      expenseCategory: invoices.expenseCategory,
      vendorId: invoices.vendorId,
      vendorName: vendors.name,
      suggestedVendorName: invoices.suggestedVendorName,
      description: invoices.description,
      sentToAccountantAt: invoices.sentToAccountantAt,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
    )
    .where(and(...conditions))
    .orderBy(desc(invoices.invoiceDate), desc(invoices.id))
    .limit(limit);

  return {
    object: "list" as const,
    data: rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      invoice_number: r.invoiceNumber,
      invoice_date: r.invoiceDate,
      amount: r.amount,
      currency: r.currency,
      vat_amount: r.vatAmount,
      amount_without_vat: r.amountWithoutVat,
      expense_category: r.expenseCategory,
      vendor_id: r.vendorId,
      vendor_name: r.vendorName ?? r.suggestedVendorName,
      description: r.description,
      sent_to_accountant: r.sentToAccountantAt != null,
      sent_to_accountant_at: r.sentToAccountantAt?.toISOString() ?? null,
      created_at: r.createdAt?.toISOString() ?? null,
    })),
    count: rows.length,
  };
}

/** Pending / processing backlog counts for the inbox. */
export async function getInboundStatusCountsOp(userId: string) {
  const rows = await db
    .select({
      status: invoices.status,
      type: invoices.type,
      count: count(invoices.id),
    })
    .from(invoices)
    .where(eq(invoices.userId, userId))
    .groupBy(invoices.status, invoices.type);

  const summary = {
    pending_expense: 0,
    pending_income: 0,
    processing: 0,
    approved_expense: 0,
    approved_income: 0,
    rejected: 0,
  };
  for (const row of rows) {
    if (row.status === "processing") summary.processing += row.count;
    else if (row.status === "rejected") summary.rejected += row.count;
    else if (row.status === "pending" && row.type === "expense") {
      summary.pending_expense += row.count;
    } else if (row.status === "pending" && row.type === "income") {
      summary.pending_income += row.count;
    } else if (row.status === "approved" && row.type === "expense") {
      summary.approved_expense += row.count;
    } else if (row.status === "approved" && row.type === "income") {
      summary.approved_income += row.count;
    }
  }
  return summary;
}

export interface SpendInsight {
  kind:
    | "vendor_spend_spike"
    | "vendor_spend_drop"
    | "vendor_concentration"
    | "burn_above_average"
    | "burn_below_average"
    | "pending_backlog"
    | "loss_making_period"
    | "healthy_margin";
  severity: "info" | "watch" | "alert";
  title: string;
  detail: string;
  vendor_id?: string | null;
  vendor_name?: string;
  metrics?: Record<string, number | string | null>;
}

type SqlCondition = ReturnType<typeof eq> | ReturnType<typeof sql>;

/**
 * Heuristic spend / savings signals for agents.
 * Not a budget system — period-over-period and concentration heuristics only.
 */
export async function getSpendInsightsOp(
  userId: string,
  opts: {
    /** Lookback window in days for the "current" period (default 90). */
    windowDays?: number;
    /** Min relative increase to flag a vendor spike (default 0.25 = 25%). */
    spikePct?: number;
    /** Min absolute increase in display currency to flag a spike. */
    spikeMinAmount?: number;
    /** Share of total spend that counts as concentration (default 0.25). */
    concentrationPct?: number;
  } = {},
) {
  const windowDays = opts.windowDays ?? 90;
  const spikePct = opts.spikePct ?? 0.25;
  const spikeMinAmount = opts.spikeMinAmount ?? 200;
  const concentrationPct = opts.concentrationPct ?? 0.25;

  const currency = await getDisplayCurrencyForUser(userId);
  const displayAmt = sqlAmountInDisplayCurrency(
    sql`${invoices.amount}::numeric`,
    currency,
  );

  const currentEnd = new Date();
  const currentStart = new Date();
  currentStart.setDate(currentStart.getDate() - windowDays);
  const previousEnd = new Date(currentStart);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - windowDays);

  const iso = (d: Date) => d.toISOString().split("T")[0]!;

  async function vendorTotals(from: string, to: string) {
    const rows = await db
      .select({
        vendorId: invoices.vendorId,
        vendorName: sql<string>`coalesce(${vendors.name}, 'Unknown')`,
        total: sql<string>`coalesce(sum(${displayAmt}), 0)`,
      })
      .from(invoices)
      .leftJoin(
        vendors,
        and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
      )
      .where(
        and(
          eq(invoices.userId, userId),
          eq(invoices.status, "approved"),
          eq(invoices.type, "expense"),
          gte(invoices.invoiceDate, from),
          lte(invoices.invoiceDate, to),
        ),
      )
      .groupBy(invoices.vendorId, vendors.name);

    const map = new Map<
      string,
      { vendorId: string | null; vendorName: string; total: number }
    >();
    let grand = 0;
    for (const row of rows) {
      const total = parseFloat(row.total);
      grand += total;
      const key = row.vendorId ?? `name:${row.vendorName}`;
      map.set(key, {
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        total,
      });
    }
    return { map, grand };
  }

  const current = await vendorTotals(iso(currentStart), iso(currentEnd));
  const previous = await vendorTotals(iso(previousStart), iso(previousEnd));

  const insights: SpendInsight[] = [];

  for (const [key, cur] of current.map) {
    const prev = previous.map.get(key)?.total ?? 0;
    const delta = cur.total - prev;
    if (delta < spikeMinAmount) continue;
    const rel = prev > 0 ? delta / prev : cur.total > spikeMinAmount ? 1 : 0;
    if (prev === 0 && cur.total >= spikeMinAmount * 2) {
      insights.push({
        kind: "vendor_spend_spike",
        severity: "watch",
        title: `New / resumed spend at ${cur.vendorName}`,
        detail: `Spent ${fmt(cur.total, currency)} in the last ${windowDays} days with little or no spend in the prior window. Worth confirming this is intentional.`,
        vendor_id: cur.vendorId,
        vendor_name: cur.vendorName,
        metrics: {
          current_total: cur.total,
          previous_total: prev,
          delta,
          window_days: windowDays,
        },
      });
    } else if (rel >= spikePct) {
      insights.push({
        kind: "vendor_spend_spike",
        severity: rel >= 0.5 ? "alert" : "watch",
        title: `Spend up ${Math.round(rel * 100)}% at ${cur.vendorName}`,
        detail: `${fmt(cur.total, currency)} in the last ${windowDays} days vs ${fmt(prev, currency)} in the prior ${windowDays} days (+${fmt(delta, currency)}). Review invoices or renegotiate if this isn't planned growth.`,
        vendor_id: cur.vendorId,
        vendor_name: cur.vendorName,
        metrics: {
          current_total: cur.total,
          previous_total: prev,
          delta,
          change_pct: Math.round(rel * 1000) / 10,
          window_days: windowDays,
        },
      });
    }
  }

  // Concentration: vendors dominating the current window.
  if (current.grand > 0) {
    for (const cur of current.map.values()) {
      const share = cur.total / current.grand;
      if (share >= concentrationPct) {
        insights.push({
          kind: "vendor_concentration",
          severity: share >= 0.4 ? "alert" : "watch",
          title: `${cur.vendorName} is ${Math.round(share * 100)}% of spend`,
          detail: `In the last ${windowDays} days, ${fmt(cur.total, currency)} of ${fmt(current.grand, currency)} went to this vendor. High concentration can mean dependency risk — or a place to negotiate volume discounts.`,
          vendor_id: cur.vendorId,
          vendor_name: cur.vendorName,
          metrics: {
            share_pct: Math.round(share * 1000) / 10,
            vendor_total: cur.total,
            period_total: current.grand,
          },
        });
      }
    }
  }

  // Burn vs trailing monthly average (from last-12-months expense dashboard).
  const expense = await getExpenseDashboardOp(userId, {
    timeRange: "last12Months",
  });
  if (expense.monthly_average > 0) {
    const burnRatio =
      expense.thirty_day_burn_rate / expense.monthly_average;
    if (burnRatio >= 1.2) {
      insights.push({
        kind: "burn_above_average",
        severity: burnRatio >= 1.5 ? "alert" : "watch",
        title: "Recent burn is above the monthly average",
        detail: `Last-30-day spend is ${fmt(expense.thirty_day_burn_rate, currency)} vs a ${fmt(expense.monthly_average, currency)} monthly average (${Math.round(burnRatio * 100)}%). Pace looks elevated — check large one-offs vs ongoing cost creep.`,
        metrics: {
          thirty_day_burn: expense.thirty_day_burn_rate,
          monthly_average: expense.monthly_average,
          burn_vs_avg_ratio: Math.round(burnRatio * 100) / 100,
        },
      });
    } else if (burnRatio > 0 && burnRatio <= 0.7) {
      insights.push({
        kind: "burn_below_average",
        severity: "info",
        title: "Recent burn is below the monthly average",
        detail: `Last-30-day spend is ${fmt(expense.thirty_day_burn_rate, currency)} vs a ${fmt(expense.monthly_average, currency)} monthly average. Either costs are down, or invoices are still pending approval.`,
        metrics: {
          thirty_day_burn: expense.thirty_day_burn_rate,
          monthly_average: expense.monthly_average,
          burn_vs_avg_ratio: Math.round(burnRatio * 100) / 100,
        },
      });
    }
  }

  const backlog = await getInboundStatusCountsOp(userId);
  const pendingTotal = backlog.pending_expense + backlog.pending_income;
  if (pendingTotal > 0) {
    insights.push({
      kind: "pending_backlog",
      severity: pendingTotal >= 10 ? "watch" : "info",
      title: `${pendingTotal} invoice(s) awaiting approval`,
      detail: `${backlog.pending_expense} expense and ${backlog.pending_income} income invoices are still pending. Approved totals (and insights) exclude them until reviewed.`,
      metrics: {
        pending_expense: backlog.pending_expense,
        pending_income: backlog.pending_income,
        processing: backlog.processing,
      },
    });
  }

  const profit = await getProfitSummaryOp(userId, {
    timeRange: "last12Months",
  });
  if (profit.total_income > 0 || profit.total_expense > 0) {
    if (profit.net_profit < 0) {
      insights.push({
        kind: "loss_making_period",
        severity: "alert",
        title: "Expenses exceed income (last 12 months)",
        detail: `Net ${fmt(profit.net_profit, currency)} on ${fmt(profit.total_income, currency)} income and ${fmt(profit.total_expense, currency)} expenses. Focus on the top vendors and loss months.`,
        metrics: {
          net_profit: profit.net_profit,
          total_income: profit.total_income,
          total_expense: profit.total_expense,
          profit_margin_pct: profit.profit_margin_pct,
        },
      });
    } else if (profit.profit_margin_pct >= 20) {
      insights.push({
        kind: "healthy_margin",
        severity: "info",
        title: `Healthy ${profit.profit_margin_pct}% margin (last 12 months)`,
        detail: `Net ${fmt(profit.net_profit, currency)}. Room to invest, or keep tightening the largest vendors if you want more cash buffer.`,
        metrics: {
          net_profit: profit.net_profit,
          profit_margin_pct: profit.profit_margin_pct,
        },
      });
    }
  }

  // Sort alerts first, then watch, then info.
  const rank = { alert: 0, watch: 1, info: 2 } as const;
  insights.sort((a, b) => rank[a.severity] - rank[b.severity]);

  // Vendors whose spend fell sharply — soft "savings" / churn signal.
  const savings: SpendInsight[] = [];
  for (const [key, prevRow] of previous.map) {
    const cur = current.map.get(key)?.total ?? 0;
    const drop = prevRow.total - cur;
    if (drop < spikeMinAmount) continue;
    const rel = prevRow.total > 0 ? drop / prevRow.total : 0;
    if (rel >= spikePct) {
      savings.push({
        kind: "vendor_spend_drop",
        severity: "info",
        title: `Spend down ${Math.round(rel * 100)}% at ${prevRow.vendorName}`,
        detail: `${fmt(cur, currency)} in the last ${windowDays} days vs ${fmt(prevRow.total, currency)} before (−${fmt(drop, currency)}). Possible saving — or missing invoices still pending.`,
        vendor_id: prevRow.vendorId,
        vendor_name: prevRow.vendorName,
        metrics: {
          current_total: cur,
          previous_total: prevRow.total,
          delta: -drop,
          change_pct: -Math.round(rel * 1000) / 10,
          window_days: windowDays,
        },
      });
    }
  }

  return {
    object: "spend_insights" as const,
    currency,
    window: {
      current_from: iso(currentStart),
      current_to: iso(currentEnd),
      previous_from: iso(previousStart),
      previous_to: iso(previousEnd),
      window_days: windowDays,
    },
    totals: {
      current_spend: current.grand,
      previous_spend: previous.grand,
      delta: current.grand - previous.grand,
      change_pct:
        previous.grand > 0
          ? Math.round(((current.grand - previous.grand) / previous.grand) * 1000) /
            10
          : null,
    },
    insights: [...insights, ...savings].sort(
      (a, b) => rank[a.severity] - rank[b.severity],
    ),
    top_vendors_current: withShares(
      [...current.map.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map((v) => ({
          vendorId: v.vendorId,
          vendorName: v.vendorName,
          total: v.total,
        })),
      current.grand,
    ),
  };
}

/** Combined snapshot for “how is the business doing?” agent questions. */
export async function getBusinessStatusOp(
  userId: string,
  filters: AnalyticsPeriodFilters = { timeRange: "last12Months" },
) {
  const period = { timeRange: "last12Months" as const, ...filters };
  const [profit, expense, income, backlog, insights] = await Promise.all([
    getProfitSummaryOp(userId, period),
    getExpenseDashboardOp(userId, period),
    getIncomeDashboardOp(userId, period),
    getInboundStatusCountsOp(userId),
    getSpendInsightsOp(userId),
  ]);

  return {
    object: "business_status" as const,
    currency: profit.currency,
    period: profit.period,
    summary: {
      total_income: profit.total_income,
      total_expense: profit.total_expense,
      net_profit: profit.net_profit,
      profit_margin_pct: profit.profit_margin_pct,
      monthly_average_expense: expense.monthly_average,
      thirty_day_burn_rate: expense.thirty_day_burn_rate,
      thirty_day_income_run_rate: income.thirty_day_run_rate,
      vendor_count: expense.vendor_count,
      client_count: income.client_count,
    },
    inbox: backlog,
    top_expense_vendors: expense.spend_by_vendor.slice(0, 8),
    top_income_clients: income.earned_by_client.slice(0, 8),
    insights: insights.insights.slice(0, 12),
    insight_window: insights.window,
    monthly_pnl: profit.monthly_breakdown,
  };
}

function normalizePeriod(filters: AnalyticsPeriodFilters) {
  return {
    time_range: filters.timeRange ?? "allTime",
    year: filters.year ?? null,
    months: filters.months ?? [],
    date_from: filters.dateFrom ?? null,
    date_to: filters.dateTo ?? null,
    show_without_vat: filters.showWithoutVat ?? false,
  };
}

function fmt(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IL", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}
