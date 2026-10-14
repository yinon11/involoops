import type { ReactNode } from "react";
import { Clock, TrendingDown, AlertTriangle } from "lucide-react";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getCollectionsDashboardData } from "@/features/generator/actions/collections-actions";
import { getDictionary } from "@/lib/i18n/server";
import { AgingTable } from "@/features/generator/components/collections/aging-table";
import { AgingBarChart } from "@/features/generator/components/collections/aging-bar-chart";

export const metadata = {
  title: "Collections — InvoLoops Studio",
  robots: { index: false, follow: false },
};

export default async function CollectionsPage() {
  await requireGeneratorAccess();
  const [data, dict] = await Promise.all([
    getCollectionsDashboardData(),
    getDictionary(),
  ]);

  const L = dict.shell.creator.collections;

  const sym =
    data.currency === "ILS"
      ? "₪"
      : data.currency === "USD"
        ? "$"
        : data.currency === "EUR"
          ? "€"
          : data.currency;

  const avgTone =
    data.avgCreditDays == null
      ? ("slate" as const)
      : data.avgCreditDays <= 30
        ? ("emerald" as const)
        : data.avgCreditDays <= 60
          ? ("amber" as const)
          : ("red" as const);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-100">
          <TrendingDown className="h-5 w-5" />
        </span>
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight text-slate-900"
            style={{
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              letterSpacing: "-0.02em",
            }}
          >
            {L.pageTitle}
          </h1>
          <p className="text-sm text-slate-500">{L.pageSubtitle}</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <CollectionStatCard
          label={L.statOpenInvoices}
          value={String(data.openCount)}
          sub={`${sym}${data.openTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${L.statOutstanding}`}
          tone="amber"
          icon={<TrendingDown className="h-5 w-5" />}
        />
        <CollectionStatCard
          label={L.statAvgDays}
          value={data.avgCreditDays != null ? `${data.avgCreditDays}d` : "—"}
          sub={L.statAvgDaysSub}
          tone={avgTone}
          icon={<Clock className="h-5 w-5" />}
        />
        <CollectionStatCard
          label={L.statOverdue}
          value={String(data.agingBuckets["90+"].count)}
          sub={`${sym}${data.agingBuckets["90+"].total.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${L.statOutstanding}`}
          tone={data.agingBuckets["90+"].count > 0 ? "red" : "emerald"}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </div>

      {/* Chart + table */}
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

/* ─── Stat card ─────────────────────────────────────────────────────────── */

type Tone = "emerald" | "amber" | "red" | "slate";

function CollectionStatCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: Tone;
  icon: ReactNode;
}) {
  const iconCls: Record<Tone, string> = {
    emerald: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100",
    amber: "bg-amber-50 text-amber-600 ring-1 ring-amber-100",
    red: "bg-red-50 text-red-600 ring-1 ring-red-100",
    slate: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  };
  const accentCls: Record<Tone, string> = {
    emerald: "from-emerald-400/70 to-emerald-600/70",
    amber: "from-amber-400/70 to-amber-600/70",
    red: "from-red-400/70 to-red-600/70",
    slate: "from-slate-300/60 to-slate-200/60",
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accentCls[tone]}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </p>
          <p className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">
            {value}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">{sub}</p>
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconCls[tone]}`}
        >
          {icon}
        </span>
      </div>
    </div>
  );
}
