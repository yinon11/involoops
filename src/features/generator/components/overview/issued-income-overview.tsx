import Link from "next/link";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  sql as dsql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { customers, outboundInvoices } from "@/db/schema";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { localeConfig } from "@/lib/i18n/config";
import { format } from "@/lib/i18n";
import { DocumentStatusChip } from "@/features/generator/components/outbound/document-status-chip";
import { getCollectionsDashboardData } from "@/features/generator/actions/collections-actions";
import { getRecommendations } from "@/features/generator/actions/recommendation-actions";
import { RecommendationsPanel } from "@/features/generator/components/recommendations/recommendations-panel";
import {
  BandCell,
  Delta,
  Panel,
  StatBand,
  formatMoney,
} from "@/components/dashboard/primitives";
import { CashflowChart } from "@/components/dashboard/cashflow-chart";
import { ShareDonut } from "@/components/dashboard/share-donut";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import type { Period } from "@/components/dashboard/period";
import {
  ArrowRight,
  Clock,
  FileText,
  Files,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { sqlAmountInDisplayCurrency } from "@/lib/fx";
import { revenueSumExpr } from "@/lib/outbound/revenue";
import { getUserDisplayCurrency } from "@/lib/display-currency";

const YEARS = [2023, 2024, 2025, 2026, 2027];

/** Revenue booked by a document, in the viewer's display currency. */
function revenueExpr(displayCurrency: string) {
  return revenueSumExpr(
    sqlAmountInDisplayCurrency(
      dsql`coalesce(${outboundInvoices.subtotal}::numeric, 0)`,
      displayCurrency,
      outboundInvoices.currency,
    ),
  );
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * What you billed out: the main tab of the income overview.
 *
 * It answers a narrower question than Home — not "how is the business doing"
 * but "how is my billing doing" — so it leads with money rather than a count
 * of documents, and names the customers behind the number, which is the one
 * thing an owner cannot get from a list of invoices.
 *
 * Reads `outbound_invoices`: documents this business *issued*. Income that
 * arrived as an uploaded document lives in `invoices` with `type = 'income'`
 * and is a different population with its own tab — see `money-in/page.tsx`.
 *
 * The period arrives parsed from the URL rather than from React state, so the
 * whole tab stays a server component and a filtered view is a link.
 */
export async function IssuedIncomeOverview({ period }: { period: Period }) {
  const session = await requireGeneratorAccess();
  const displayCurrency = await getUserDisplayCurrency(session.user.id);
  const REVENUE = revenueExpr(displayCurrency);

  const [dict, locale, entity, collections, topRecs] = await Promise.all([
    getDictionary(),
    getLocale(),
    getBusinessEntityForUserOrNull(session.user.id),
    getCollectionsDashboardData().catch(() => null),
    getRecommendations().catch(() => []),
  ]);

  const L = dict.shell.creator.landing;
  const D = dict.homeDash;
  const F = dict.dashboard.filters;
  const isRtl = localeConfig[locale].dir === "rtl";
  const now = new Date();

  // ── Period → SQL window ─────────────────────────────────────────────────
  // `invoice_date` is a DATE column, so the bounds are plain YYYY-MM-DD; a
  // timestamp's UTC shift could otherwise pull a boundary into the day before.
  let from: string | null = null;
  let to: string | null = null;
  let previousFrom: string | null = null;
  if (period.range === "last12Months") {
    from = localDate(new Date(now.getFullYear() - 1, now.getMonth(), 1));
    previousFrom = localDate(new Date(now.getFullYear() - 2, now.getMonth(), 1));
  } else if (period.range === "year" && period.year != null) {
    from = `${period.year}-01-01`;
    to = `${period.year + 1}-01-01`;
    previousFrom = `${period.year - 1}-01-01`;
  }

  const windowConds = (start: string | null, end: string | null): SQL[] => {
    const conds: SQL[] = [];
    if (start) conds.push(gte(outboundInvoices.invoiceDate, start));
    if (end) conds.push(lt(outboundInvoices.invoiceDate, end));
    return conds;
  };
  const monthCond =
    period.months.length > 0
      ? [
          inArray(
            dsql<number>`extract(month from ${outboundInvoices.invoiceDate})::int`,
            period.months,
          ),
        ]
      : [];

  let billed = 0;
  let billedPrevious = 0;
  let docsInPeriod = 0;
  let totalDocs = 0;
  let pendingIta = 0;
  let recent: RecentRow[] = [];
  let monthlyPoints: { label: string; income: number; expense: number; net: number }[] = [];
  let byCustomer: { id: string | null; name: string; total: number }[] = [];
  const currency = displayCurrency;

  // Accounts that have not saved their business details have no entity and so
  // no documents — skip the queries and render zeroes behind a setup prompt.
  if (entity) {
    const scoped = and(
      eq(outboundInvoices.businessEntityId, entity.id),
      isNull(outboundInvoices.deletedAt),
    );
    const live = and(scoped, ne(outboundInvoices.status, "voided"));
    const inPeriod = and(live, ...windowConds(from, to), ...monthCond);

    const [
      periodRow,
      previousRow,
      counts,
      pending,
      recentRows,
      monthRows,
      customerRows,
    ] = await Promise.all([
      db
        .select({ revenue: REVENUE, docs: dsql<number>`count(*)::int` })
        .from(outboundInvoices)
        .where(inPeriod)
        .then((r) => r[0] ?? { revenue: 0, docs: 0 }),
      // The comparable previous window, for the trend chip. "All time" has no
      // previous, so it simply has no comparison rather than a fake one.
      previousFrom
        ? db
            .select({ revenue: REVENUE })
            .from(outboundInvoices)
            .where(
              and(live, ...windowConds(previousFrom, from), ...monthCond),
            )
            .then((r) => r[0]?.revenue ?? 0)
        : Promise.resolve(0),
      db
        .select({ total: dsql<number>`count(*)::int` })
        .from(outboundInvoices)
        .where(scoped)
        .then((r) => r[0]?.total ?? 0),
      db
        .select({ c: dsql<number>`count(*)::int` })
        .from(outboundInvoices)
        .where(
          and(scoped, inArray(outboundInvoices.shaamStatus, ["PENDING", "OUTAGE_ISSUED"])),
        )
        .then((r) => r[0]?.c ?? 0),
      recentDocumentsQuery(scoped),
      db
        .select({
          bucket: dsql<string>`to_char(${outboundInvoices.invoiceDate}, 'YYYY-MM')`,
          revenue: REVENUE,
        })
        .from(outboundInvoices)
        .where(inPeriod)
        .groupBy(dsql`to_char(${outboundInvoices.invoiceDate}, 'YYYY-MM')`)
        .orderBy(dsql`to_char(${outboundInvoices.invoiceDate}, 'YYYY-MM')`),
      db
        .select({
          id: outboundInvoices.customerId,
          name: customers.name,
          revenue: REVENUE,
        })
        .from(outboundInvoices)
        .leftJoin(customers, eq(outboundInvoices.customerId, customers.id))
        .where(inPeriod)
        .groupBy(outboundInvoices.customerId, customers.name),
    ]);

    billed = Number(periodRow.revenue) || 0;
    billedPrevious = Number(previousRow) || 0;
    docsInPeriod = periodRow.docs;
    totalDocs = counts;
    pendingIta = pending;
    recent = recentRows;

    monthlyPoints = monthRows.map((row) => {
      const [y, m] = row.bucket.split("-");
      const name = D.monthsShort[Number(m) - 1] ?? m;
      return {
        // Year-tagged only when the window can span two, so a 12-slot chart
        // never shows two unlabelled "Jan"s.
        label: period.range === "year" ? name : `${name} ${y.slice(2)}`,
        income: Math.round(Number(row.revenue) || 0),
        expense: 0,
        net: 0,
      };
    });

    byCustomer = customerRows
      .map((row) => ({
        id: row.id,
        name: row.name ?? L.noCustomer,
        total: Number(row.revenue) || 0,
      }))
      .filter((row) => row.total > 0);
  }

  const openCount = collections?.openCount ?? 0;
  const openTotal = collections?.openTotal ?? 0;
  const oldestDays = collections?.agingRows[0]?.daysOutstanding ?? 0;

  return (
    <div className="space-y-6">
      <PeriodFilter
        period={period}
        years={YEARS}
        labels={{
          when: F.groupWhen,
          months: F.groupMonths,
          allTimes: F.allTimes,
          last12Months: F.last12Months,
          selectYear: F.selectYear,
          allYear: F.allYear,
          monthNames: D.monthsShort,
          monthHint: F.monthTooltipYear,
          reset: F.reset,
        }}
      />

      {/* Money first, paperwork second. */}
      <StatBand>
        <BandCell
          label={L.statBilled}
          value={formatMoney(billed, currency)}
          icon={<TrendingUp className="h-4 w-4" />}
          accent="emerald"
          emphasis
          href="/money-in"
          caption={
            previousFrom ? (
              <Delta
                current={billed}
                previous={billedPrevious}
                labels={{
                  up: L.vsPrevious,
                  down: L.vsPrevious,
                  flat: D.deltaFlat,
                  noPrior: D.deltaNoPrior,
                }}
              />
            ) : (
              <span className="text-xs text-slate-500">
                {format(L.statDocsCaption, { count: docsInPeriod })}
              </span>
            )
          }
        />
        <BandCell
          label={L.statOutstanding}
          value={formatMoney(openTotal, collections?.currency ?? currency)}
          icon={<Wallet className="h-4 w-4" />}
          accent={oldestDays > 60 ? "rose" : openCount > 0 ? "amber" : "slate"}
          href="/outbound/collections"
          caption={
            <span className="text-xs text-slate-500">
              {openCount > 0
                ? format(L.statOutstandingCaption, {
                    count: openCount,
                    days: oldestDays,
                  })
                : L.statOutstandingClear}
            </span>
          }
        />
        <BandCell
          label={L.statDocuments}
          value={String(docsInPeriod)}
          icon={<Files className="h-4 w-4" />}
          accent="violet"
          href="/outbound"
          caption={
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              <span>{format(L.statTotalCaption, { count: totalDocs })}</span>
              {pendingIta > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                  <Clock className="h-3 w-3" />
                  {format(L.statPendingCaption, { count: pendingIta })}
                </span>
              ) : null}
            </span>
          }
        />
      </StatBand>

      {!entity && (
        <Link
          href="/settings/business-details"
          className="group flex items-center justify-between gap-4 rounded-2xl border border-violet-200 bg-violet-50/60 px-5 py-4 transition-colors hover:bg-violet-50"
        >
          <span className="text-sm font-medium text-violet-900">
            {L.setupPrompt}
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-violet-500 rtl:rotate-180" />
        </Link>
      )}

      {topRecs.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <RecommendationsPanel initialRecs={topRecs} limit={3} />
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title={L.chartTitle}
          subtitle={L.chartSubtitle}
          action={{ href: "/money-in", label: L.chartAction }}
        >
          {monthlyPoints.length === 0 ? (
            <p className="px-5 py-16 text-center text-sm text-slate-400">
              {L.chartEmpty}
            </p>
          ) : (
            <CashflowChart
              data={monthlyPoints}
              currency={currency}
              rtl={isRtl}
              series={["income"]}
              labels={{ income: L.chartSeries, expense: "", net: "" }}
            />
          )}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title={L.customersTitle}
          subtitle={L.customersSubtitle}
          action={{ href: "/customers", label: L.customersAction }}
        >
          <ShareDonut
            slices={byCustomer}
            currency={currency}
            totalLabel={L.customersTotal}
            emptyLabel={L.customersEmpty}
            otherLabel={L.otherCustomers}
          />
        </Panel>
      </div>

      <Panel
        title={L.recentTitle}
        action={{ href: "/outbound", label: L.quickViewInvoices }}
      >
        {recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <FileText className="h-5 w-5" />
            </span>
            <p className="text-sm text-slate-500">{L.recentEmpty}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/outbound/${inv.id}`}
                  className="group flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 transition-colors group-hover:bg-violet-100">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {inv.customerName ?? "—"}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-slate-500">
                          {inv.formattedNumber}
                        </span>
                      </span>
                      <DocumentStatusChip
                        status={inv.status ?? "draft"}
                        shaamStatus={inv.shaamStatus}
                        dict={dict}
                        size="sm"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="hidden text-xs text-slate-500 sm:inline">
                      {inv.invoiceDate}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatMoney(Number(inv.total), inv.currency ?? currency)}
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-violet-600 rtl:rotate-180" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

type RecentRow = Awaited<ReturnType<typeof recentDocumentsQuery>>[number];

/** Last few documents with the customer they went to. */
function recentDocumentsQuery(scoped: SQL | undefined) {
  return db
    .select({
      id: outboundInvoices.id,
      formattedNumber: outboundInvoices.formattedNumber,
      customerName: customers.name,
      invoiceDate: outboundInvoices.invoiceDate,
      total: outboundInvoices.total,
      currency: outboundInvoices.currency,
      status: outboundInvoices.status,
      shaamStatus: outboundInvoices.shaamStatus,
    })
    .from(outboundInvoices)
    .leftJoin(customers, eq(outboundInvoices.customerId, customers.id))
    .where(scoped)
    .orderBy(desc(outboundInvoices.createdAt))
    .limit(6);
}
