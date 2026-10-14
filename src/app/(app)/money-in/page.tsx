import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Clock, FileMinus, FilePlus2, TrendingDown } from "lucide-react";
import {
  getIncomeData,
  getProfitData,
  type DashboardClientFilters,
  type ProfitClientFilters,
} from "@/features/expenses/actions/invoice-actions";
import { IncomeClient } from "@/features/expenses/components/income/income-client";
import { ProfitClient } from "@/features/expenses/components/profit/profit-client";
import { IssuedIncomeOverview } from "@/features/generator/components/overview/issued-income-overview";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getCollectionsDashboardData } from "@/features/generator/actions/collections-actions";
import { getDictionary } from "@/lib/i18n/server";
import { ensureCapOrNotFound } from "@/lib/team/enforce";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgingTable } from "@/features/generator/components/collections/aging-table";
import { AgingBarChart } from "@/features/generator/components/collections/aging-bar-chart";
import { readPeriod } from "@/components/dashboard/period";
import {
  BandCell,
  StatBand,
  formatMoney,
} from "@/components/dashboard/primitives";

export const metadata = {
  title: "Income overview",
  robots: { index: false, follow: false },
};

const defaultIncomeFilters: DashboardClientFilters = {
  vendorIds: [],
  timeRange: "last12Months",
  year: null,
  months: [],
  dateFrom: null,
  dateTo: null,
  showWithoutVat: false,
};

const defaultProfitFilters: ProfitClientFilters = {
  timeRange: "last12Months",
  year: null,
  months: [],
  dateFrom: null,
  dateTo: null,
};

const TABS = ["overview", "outstanding", "profit", "uploaded"] as const;
type Tab = (typeof TABS)[number];

/**
 * Income overview — one page for everything that brings money in.
 *
 * It used to be two nav entries answering the same question from different
 * ends: "Overview" charted documents this business *issued*, "Money In"
 * charted income documents it *received* as uploads. Both are money in, and
 * having them apart meant neither page could be trusted as the answer.
 *
 * They are tabs now, and the distinction they encode is kept rather than
 * papered over, because the two really are different populations:
 *
 *   - **Overview** reads `outbound_invoices` — what you billed.
 *   - **Uploaded income** reads `invoices` where `type = 'income'` — documents
 *     that arrived from a vendor flagged as an income source (see
 *     `upload-actions.ts`).
 *   - **Profit** adds both. Every issued invoice counts as income, a credit
 *     note deducts, and a full credit (which voids the original) deducts
 *     once — the original stays and the credit note is the deduction.
 *     Uploading a copy of an invoice you also issued still counts twice.
 *
 * Shape deliberately mirrors the expenses overview: header, tabs, a visible
 * filter row, a headline strip, two charts, a table. Moving between the two
 * sides of the business should not feel like moving between two products.
 */
export default async function MoneyInPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    range?: string;
    year?: string;
    months?: string;
  }>;
}) {
  await ensureCapOrNotFound("view_reports");

  const params = await searchParams;
  const dict = await getDictionary();
  const t = dict.moneyIn;
  // `income` is the old query value for what is now the uploaded tab; keep it
  // working so existing links and bookmarks do not land on the wrong view.
  const requested = params.tab === "income" ? "uploaded" : params.tab;
  const defaultTab: Tab = TABS.includes(requested as Tab)
    ? (requested as Tab)
    : "overview";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {t.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t.subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href="/outbound/new"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-600/25"
          >
            <FilePlus2 className="h-4 w-4 shrink-0" />
            {dict.shell.creator.landing.quickNewInvoice}
          </Link>
          <Link
            href="/outbound/new-credit"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:text-violet-700 hover:shadow-md"
          >
            <FileMinus className="h-4 w-4 shrink-0" />
            {dict.shell.creator.landing.quickNewCredit}
          </Link>
        </div>
      </header>

      <Tabs defaultValue={defaultTab} className="w-full">
        <div className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
          <TabsList>
            <TabsTrigger value="overview">{t.tabs.overview}</TabsTrigger>
            <TabsTrigger value="outstanding">{t.tabs.outstanding}</TabsTrigger>
            <TabsTrigger value="profit">{t.tabs.profit}</TabsTrigger>
            <TabsTrigger value="uploaded">{t.tabs.uploaded}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <Suspense fallback={<MoneyInSkeleton />}>
            <IssuedIncomeOverview period={readPeriod(params)} />
          </Suspense>
        </TabsContent>

        <TabsContent value="outstanding">
          <Suspense fallback={<MoneyInSkeleton />}>
            <OutstandingTab />
          </Suspense>
        </TabsContent>

        <TabsContent value="profit">
          <Suspense fallback={<MoneyInSkeleton />}>
            <ProfitTab />
          </Suspense>
        </TabsContent>

        <TabsContent value="uploaded">
          <Suspense fallback={<MoneyInSkeleton />}>
            <UploadedIncomeTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Income that arrived as an uploaded document rather than one you issued.
 * Empty for most accounts — it only fills once a vendor is flagged as an
 * income source in Settings — so it says so rather than showing bare zeroes.
 */
async function UploadedIncomeTab() {
  const [initialData, dict] = await Promise.all([
    getIncomeData(defaultIncomeFilters),
    getDictionary(),
  ]);

  if (initialData.stats.invoiceCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
        <p className="text-sm font-medium text-slate-700">
          {dict.moneyIn.uploadedEmptyTitle}
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          {dict.moneyIn.uploadedEmptyBody}
        </p>
        <Link
          href="/settings"
          className="mt-4 inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-violet-200 hover:text-violet-700"
        >
          {dict.moneyIn.uploadedEmptyAction}
        </Link>
      </div>
    );
  }

  return (
    <IncomeClient initialData={initialData} fetchIncomeData={getIncomeData} />
  );
}

async function ProfitTab() {
  const initialData = await getProfitData(defaultProfitFilters);
  return <ProfitClient initialData={initialData} fetchProfitData={getProfitData} />;
}

async function OutstandingTab() {
  let data;
  try {
    await requireGeneratorAccess();
    data = await getCollectionsDashboardData();
  } catch {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">
        Outstanding collections not available.
      </div>
    );
  }

  const dict = await getDictionary();
  const L = dict.shell.creator.collections;

  const avgTone =
    data.avgCreditDays == null ? ("slate" as const)
    : data.avgCreditDays <= 30 ? ("emerald" as const)
    : data.avgCreditDays <= 60 ? ("amber" as const)
    : ("rose" as const);

  return (
    <div className="space-y-6">
      {/* Same strip as the Overview tab and the expenses dashboard, so the
          three views of the business share one visual language. */}
      <StatBand>
        <BandCell
          label={L.statOpenInvoices}
          value={String(data.openCount)}
          icon={<TrendingDown className="h-4 w-4" />}
          accent={data.openCount > 0 ? "amber" : "slate"}
          emphasis
          caption={
            <span className="text-xs text-slate-500">
              {formatMoney(data.openTotal, data.currency)} {L.statOutstanding}
            </span>
          }
        />
        <BandCell
          label={L.statAvgDays}
          value={data.avgCreditDays != null ? `${data.avgCreditDays}d` : "—"}
          icon={<Clock className="h-4 w-4" />}
          accent={avgTone}
          caption={<span className="text-xs text-slate-500">{L.statAvgDaysSub}</span>}
        />
        <BandCell
          label={L.statOverdue}
          value={String(data.agingBuckets["90+"].count)}
          icon={<AlertTriangle className="h-4 w-4" />}
          accent={data.agingBuckets["90+"].count > 0 ? "rose" : "emerald"}
          caption={
            <span className="text-xs text-slate-500">
              {formatMoney(data.agingBuckets["90+"].total, data.currency)}{" "}
              {L.statOutstanding}
            </span>
          }
        />
      </StatBand>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <AgingBarChart
            buckets={data.agingBuckets}
            currency={data.currency}
            labels={{
              title: L.chartTitle,
              subtitle: L.chartSubtitle,
              tooltipInvoice: L.tooltipInvoice,
              tooltipInvoices: L.tooltipInvoices,
              tooltipAmount: L.tooltipAmount,
              tooltipDays: L.tooltipDays,
            }}
          />
        </div>
        <div className="lg:col-span-3">
          <AgingTable
            rows={data.agingRows}
            labels={{
              title: L.tableTitle,
              subtitle: L.tableSubtitle,
              colCustomer: L.tableColCustomer,
              colInvoice: L.tableColInvoice,
              colAmount: L.tableColAmount,
              colIssued: L.tableColIssued,
              colDaysOut: L.tableColDaysOut,
              empty: L.tableEmpty,
              emptySub: L.tableEmptySub,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function MoneyInSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      ))}
    </div>
  );
}
