import {
  Check,
  CircleCheck,
  Download,
  FileSpreadsheet,
  QrCode,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wrench,
} from "lucide-react";
import type { LandingCopy } from "./copy";

/**
 * Coded replicas of the product screens for the landing page.
 *
 * Built in markup rather than shipped as screenshots so they stay crisp, flip
 * with the page direction (RTL / LTR), and never show a real account's data.
 * Every string comes from `copy.ts`; only chart heights are fixed here.
 */

/** Income / expense pairs (thousands of ₪) behind the profit chart. */
const PROFIT_SERIES = [
  { income: 31, expenses: 17 },
  { income: 36, expenses: 21 },
  { income: 34, expenses: 16 },
  { income: 41, expenses: 22 },
  { income: 39, expenses: 18 },
  { income: 48, expenses: 20 },
];
const PROFIT_MAX = 50;

function WindowFrame({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-xl ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400/80" />
        <span className="ms-2 truncate text-[11px] font-medium text-muted-foreground">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

export function ProfitMockup({ t }: { t: LandingCopy }) {
  const m = t.insights.profitMockup;
  return (
    <div className="space-y-4 p-5">
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: m.income, value: m.incomeValue, tone: "text-violet-700" },
          { label: m.expenses, value: m.expensesValue, tone: "text-teal-700" },
          { label: m.profit, value: m.profitValue, tone: "text-foreground" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-background p-2.5"
          >
            <p className="text-[11px] text-muted-foreground">{stat.label}</p>
            <p
              className={`mt-0.5 text-sm font-bold tabular-nums sm:text-base ${stat.tone}`}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-background p-3">
        <div className="flex h-28 items-end justify-between gap-2">
          {PROFIT_SERIES.map((point, i) => (
            <div key={m.months[i]} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex h-24 w-full items-end justify-center gap-1">
                <span
                  className="w-1/3 rounded-t bg-violet-500"
                  style={{ height: `${(point.income / PROFIT_MAX) * 100}%` }}
                />
                <span
                  className="w-1/3 rounded-t bg-teal-400"
                  style={{ height: `${(point.expenses / PROFIT_MAX) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">{m.months[i]}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-violet-500" />
            {m.income}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-teal-400" />
            {m.expenses}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Hero composite: the profit dashboard with an issued-invoice toast on top. */
export function HeroMockup({ t }: { t: LandingCopy }) {
  const c = t.ai.chat;
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-violet-600/40 via-teal-500/25 to-pink-400/30 blur-3xl"
      />
      <WindowFrame title="InvoLoops" className="relative">
        <ProfitMockup t={t} />
      </WindowFrame>
      <div className="relative -mt-6 ms-6 me-auto w-[min(20rem,85%)] rounded-xl border border-border bg-card p-3.5 text-card-foreground shadow-2xl sm:-mt-10 sm:ms-auto sm:me-[-1.5rem]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Check className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold">
              {c.doneTitle} <bdi dir="ltr">{c.doneNumber}</bdi>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.doneAllocation}</p>
            <p className="truncate text-xs text-muted-foreground">{c.doneSent}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StudioMockup({ t }: { t: LandingCopy }) {
  const m = t.studio.mockup;
  return (
    <WindowFrame title={m.windowTitle}>
      <div className="grid gap-0 md:grid-cols-2">
        {/* Form */}
        <div className="space-y-3 border-b border-border p-5 md:border-b-0 md:border-e">
          {[
            { label: m.typeLabel, value: m.type },
            { label: m.customerLabel, value: m.customer },
          ].map((field) => (
            <div key={field.label}>
              <p className="text-[11px] font-medium text-muted-foreground">{field.label}</p>
              <div className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                {field.value}
              </div>
            </div>
          ))}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">{m.lineLabel}</p>
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{m.line}</span>
              <span className="text-muted-foreground">×{m.qty}</span>
              <span className="font-medium tabular-nums">{m.price}</span>
            </div>
          </div>
          <div className="flex h-10 items-center justify-center rounded-lg bg-teal-600 text-sm font-semibold text-white shadow-sm">
            {m.issue}
          </div>
        </div>

        {/* Live preview of the issued PDF */}
        <div className="bg-muted/40 p-5">
          <div className="rounded-lg border border-border bg-white p-4 text-slate-900 shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="block h-6 w-6 rounded-md bg-gradient-to-br from-violet-600 to-teal-500" />
                <p className="mt-1.5 text-xs font-semibold">{m.previewBusiness}</p>
              </div>
              <div className="text-end">
                <p className="text-sm font-bold text-violet-700">{m.previewDocTitle}</p>
                <p className="font-mono text-[11px] text-slate-500" dir="ltr">
                  {m.previewNumber}
                </p>
              </div>
            </div>
            <div className="mt-3 border-t border-slate-200 pt-2 text-[11px]">
              <p className="text-slate-500">{m.previewTo}</p>
              <p className="font-medium">{m.customer}</p>
            </div>
            <div className="mt-2 flex justify-between gap-2 rounded bg-slate-50 px-2 py-1.5 text-[11px]">
              <span className="truncate">{m.line}</span>
              <span className="tabular-nums">{m.subtotalValue}</span>
            </div>
            <dl className="mt-2 space-y-0.5 text-[11px]">
              {[
                { k: m.subtotal, v: m.subtotalValue },
                { k: m.vat, v: m.vatValue },
              ].map((row) => (
                <div key={row.k} className="flex justify-between">
                  <dt className="text-slate-500">{row.k}</dt>
                  <dd className="tabular-nums">{row.v}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-1 text-xs font-bold">
                <dt>{m.total}</dt>
                <dd className="tabular-nums">{m.totalValue}</dd>
              </div>
            </dl>
            <div className="mt-3 flex items-end justify-between gap-2 border-t border-slate-200 pt-2">
              <div className="space-y-1 text-[10px]">
                <p className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  {m.allocation}: {m.allocationValue}
                </p>
                <p className="inline-flex items-center gap-1 text-slate-500">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  {m.signed}
                </p>
              </div>
              <QrCode className="h-9 w-9 flex-shrink-0 text-slate-800" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}

export function VendorSpendMockup({ t }: { t: LandingCopy }) {
  const m = t.insights.vendorMockup;
  return (
    <WindowFrame title={m.title}>
      <div className="space-y-3 p-5">
        <p className="text-xs text-muted-foreground">{m.period}</p>
        <ul className="space-y-2.5">
          {m.rows.map((row, i) => (
            <li key={row.name}>
              <div className="flex justify-between gap-3 text-xs">
                <span className="truncate font-medium">{row.name}</span>
                <span className="tabular-nums text-muted-foreground">{row.value}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-muted">
                <div
                  className={`h-2 rounded-full ${i === 0 ? "bg-violet-600" : "bg-violet-400"}`}
                  style={{ width: `${row.pct}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          <TrendingUp className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {m.alert}
        </p>
      </div>
    </WindowFrame>
  );
}

export function SearchMockup({ t }: { t: LandingCopy }) {
  const m = t.insights.searchMockup;
  return (
    <WindowFrame title={t.nav.insights}>
      <div className="space-y-3 p-5">
        <div className="flex items-center gap-2 rounded-lg border-2 border-violet-500 bg-background px-3 py-2 text-sm shadow-sm">
          <Search className="h-4 w-4 text-violet-600" aria-hidden="true" />
          <span>{m.query}</span>
          <span className="h-4 w-px animate-pulse bg-foreground motion-reduce:animate-none" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{m.results}</p>
          <div className="flex gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white">
              <Download className="h-3 w-3" aria-hidden="true" />
              {m.zip}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold">
              <FileSpreadsheet className="h-3 w-3" aria-hidden="true" />
              {m.excel}
            </span>
          </div>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {m.rows.map((row) => (
            <li
              key={row.date}
              className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-4 w-4 flex-shrink-0 rounded border border-violet-500 bg-violet-500 text-white">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="truncate">{row.vendor}</span>
              </span>
              <span className="flex flex-shrink-0 gap-3 tabular-nums text-muted-foreground">
                <span>{row.date}</span>
                <span className="font-medium text-foreground">{row.amount}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </WindowFrame>
  );
}

export function ChatMockup({ t }: { t: LandingCopy }) {
  const c = t.ai.chat;
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#1f1e1d] text-[#f5f4ef] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#d97757] text-white">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="text-xs font-semibold">{c.appName}</span>
        <span className="ms-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
          InvoLoops · MCP
        </span>
      </div>
      <div className="space-y-4 p-4 text-sm sm:p-5">
        <p className="ms-auto max-w-[85%] rounded-2xl bg-[#393937] px-3.5 py-2.5 leading-relaxed">
          {c.user1}
        </p>

        <div className="space-y-2.5">
          <p className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 font-mono text-[10px] text-white/60">
            <Wrench className="h-3 w-3" aria-hidden="true" />
            {c.tools[0]}
          </p>
          <p>{c.assistant1}</p>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
            <p className="font-semibold">{c.draftType}</p>
            <p className="mt-1 text-white/70">{c.draftLine}</p>
            <div className="mt-2 flex justify-between border-t border-white/10 pt-2">
              <span className="text-white/70">{c.draftTotal}</span>
              <span className="font-bold tabular-nums">{c.draftTotalValue}</span>
            </div>
          </div>
          <p>{c.confirm}</p>
        </div>

        <p className="ms-auto w-fit rounded-2xl bg-[#393937] px-3.5 py-2">{c.user2}</p>

        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {c.tools.slice(1).map((tool) => (
              <p
                key={tool}
                className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 font-mono text-[10px] text-white/60"
              >
                <Wrench className="h-3 w-3" aria-hidden="true" />
                {tool}
              </p>
            ))}
          </div>
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-emerald-300">
              <CircleCheck className="h-4 w-4" aria-hidden="true" />
              <span>
                {c.doneTitle} <bdi dir="ltr">{c.doneNumber}</bdi>
              </span>
            </p>
            <p className="mt-1 text-white/80">{c.doneAllocation}</p>
            <p className="text-white/80">{c.doneSent}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
