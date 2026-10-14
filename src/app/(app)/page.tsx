import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUpRight,
  Copy,
  FilePlus2,
  Inbox,
  Scale,
  Upload,
  Wallet,
} from "lucide-react";
import { auth } from "@/auth";
import { convertAmountBetweenCurrencies } from "@/lib/fx";
import { getUserDisplayCurrency } from "@/lib/display-currency";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { format } from "@/lib/i18n";
import { localeConfig } from "@/lib/i18n/config";
import { readMode } from "@/lib/mode";
import {
  AttentionList,
  type AttentionItem,
} from "@/components/dashboard/attention-list";
import {
  CashflowChart,
  type CashflowPoint,
} from "@/components/dashboard/cashflow-chart";
import { HomePeriodFilter } from "@/components/dashboard/home-period-filter";
import {
  BandCell,
  Delta,
  Panel,
  RankList,
  StatBand,
  formatMoney,
} from "@/components/dashboard/primitives";
import { HomeSendReminderButton } from "@/components/home/send-reminder-button";
import { SponsoredOffer } from "@/components/dashboard/sponsored-offer";
import { SponsorPreviewShowcase } from "@/components/dashboard/sponsor-preview";
import { BannerSponsorSlot } from "@/components/shell/banner-sponsor-slot";
import {
  recordSponsorImpression,
  selectSponsoredOffer,
} from "@/lib/sponsors/select";
import { getCollectionsDashboardData } from "@/features/generator/actions/collections-actions";
import { getTaxEstimationData } from "@/features/generator/actions/tax-actions";
import { getPendingInvoiceCount } from "@/features/expenses/actions/invoice-actions";
import { homeCashflow } from "@/lib/dashboard/home-cashflow";
import { readHomeRange, type HomeRange } from "@/lib/dashboard/home-window";
import { getDuplicateInvoiceGroups } from "@/features/expenses/actions/duplicate-actions";

export const metadata = {
  title: "Involoops",
  robots: { index: false, follow: false },
};

/**
 * Home — the one page that answers "how is my business doing?".
 *
 * It is the only screen that reads both halves of the product at once, so it
 * is built around the comparison neither half can make alone: what came in
 * against what went out, and what is left. Everything else on the page is
 * subordinate to that — a short list of things that need a decision, and two
 * ranked lists naming the customers and vendors behind the numbers.
 *
 * Deliberately *not* here: document counts (a count of invoices tells an owner
 * nothing about their business), and a second copy of the create actions that
 * already live in the sidebar's New menu.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const sponsorPreview = params["sponsor-preview"] === "1";
  const range = readHomeRange(params.range);

  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const mode = await readMode();
  if (mode === "admin") redirect("/admin");

  const dict = await getDictionary();
  const t = dict.homeDash;
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? t.greetingMorning : hour < 18 ? t.greetingAfternoon : t.greetingEvening;
  const firstName = (session.user.name ?? "").trim().split(/\s+/)[0] ?? "";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {firstName ? `${greeting}, ${firstName}` : greeting}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t.frames.subtitle[range]}</p>
          {sponsorPreview && (
            <p className="mt-2 text-xs font-medium text-blue-600">
              📍 Sponsor preview mode active
            </p>
          )}
        </div>
        {/* The two things people come here to do, beside the greeting rather
            than stranded at the foot of the page. The rest of the old quick
            actions row were navigation, and navigation belongs in the nav. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href="/outbound/new"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-600/25"
          >
            <FilePlus2 className="h-4 w-4 shrink-0" />
            {t.quick.issue}
          </Link>
          <Link
            href="/invoices/upload"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:text-violet-700 hover:shadow-md"
          >
            <Upload className="h-4 w-4 shrink-0" />
            {t.quick.upload}
          </Link>
        </div>
      </header>

      <Suspense fallback={<HomeSkeleton />}>
        <HomeBody sponsorPreview={sponsorPreview} range={range} />
      </Suspense>
    </div>
  );
}

async function HomeBody({
  sponsorPreview = false,
  range,
}: {
  sponsorPreview?: boolean;
  range: HomeRange;
}) {
  const [dict, locale, session] = await Promise.all([
    getDictionary(),
    getLocale(),
    auth(),
  ]);
  const t = dict.homeDash;
  const isRtl = localeConfig[locale].dir === "rtl";
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth(); // 0-based

  const [tax, collections, pendingCount, duplicateGroups, cashflow, displayCurrency] =
    await Promise.all([
      getTaxEstimationData(year, { convertToDisplayCurrency: true }).catch(() => null),
      getCollectionsDashboardData().catch(() => null),
      getPendingInvoiceCount().catch(() => 0),
      getDuplicateInvoiceGroups().catch(() => []),
      session?.user?.id
        ? homeCashflow(session.user.id, range, now).catch(() => null)
        : Promise.resolve(null),
      session?.user?.id
        ? getUserDisplayCurrency(session.user.id)
        : Promise.resolve("ILS"),
    ]);

  const currency = cashflow?.currency ?? displayCurrency;
  const monthly = tax?.monthly ?? [];

  // VAT set-aside stays the current filing month. The tiles and the chart
  // follow the selected frame instead.
  const thisMonth = monthly[monthIndex] ?? null;

  const moneyIn = cashflow?.moneyIn ?? 0;
  const moneyOut = cashflow?.moneyOut ?? 0;
  const net = moneyIn - moneyOut;
  const prevIn = cashflow?.prevIn ?? 0;
  const prevOut = cashflow?.prevOut ?? 0;
  const margin = moneyIn > 0 ? Math.round((net / moneyIn) * 100) : 0;
  const compareLabel = range === "allTime" ? null : t.frames.compare[range];

  const deltaLabels = {
    up: compareLabel ?? t.deltaUp,
    down: compareLabel ?? t.deltaDown,
    flat: t.deltaFlat,
    noPrior: t.deltaNoPrior,
  };

  const spansYears =
    new Set((cashflow?.points ?? []).map((point) => point.key.slice(0, 4))).size > 1;
  const points: CashflowPoint[] = (cashflow?.points ?? []).map((point) => {
    const [y, m, d] = point.key.split("-");
    const monthName = t.monthsShort[Number(m) - 1] ?? m;
    const label = d
      ? `${Number(d)}/${Number(m)}`
      : spansYears
        ? `${monthName} ${y.slice(2)}`
        : monthName;
    return {
      label,
      income: Math.round(point.income),
      expense: Math.round(point.expense),
      net: Math.round(point.income - point.expense),
    };
  });

  // ── Needs attention, most costly decision first ─────────────────────────
  const items: AttentionItem[] = [];

  const openCount = collections?.openCount ?? 0;
  if (openCount > 0 && collections) {
    const oldest = collections.agingRows[0]?.daysOutstanding ?? 0;
    items.push({
      key: "unpaid",
      tone: oldest > 60 ? "urgent" : "warning",
      icon: <Wallet className="h-4 w-4" />,
      title: format(t.attention.unpaid, {
        count: openCount,
        amount: formatMoney(collections.openTotal, currency),
      }),
      meta: format(t.attention.unpaidMeta, { days: oldest }),
      href: "/outbound/collections",
      cta: (
        <HomeSendReminderButton
          label={t.attention.remind}
          targets={collections.agingRows
            .filter((row) => row.customerEmail)
            .map((row) => ({
              id: row.id,
              customerName: row.customerName,
              customerEmail: row.customerEmail as string,
              formattedNumber: row.formattedNumber,
            }))}
          skippedNoEmail={
            collections.agingRows.filter((row) => !row.customerEmail).length
          }
        />
      ),
    });
  }

  const vatDue = thisMonth?.vatDue ?? 0;
  if (vatDue > 0) {
    items.push({
      key: "vat",
      tone: "warning",
      icon: <Scale className="h-4 w-4" />,
      title: format(t.attention.vat, {
        amount: formatMoney(vatDue, currency),
      }),
      meta: t.attention.vatMeta,
      href: "/outbound/tax-estimates",
    });
  }

  if (pendingCount > 0) {
    items.push({
      key: "pending",
      tone: "info",
      icon: <Inbox className="h-4 w-4" />,
      title: format(
        pendingCount === 1 ? t.attention.pendingOne : t.attention.pendingMany,
        { count: pendingCount },
      ),
      meta: t.attention.pendingMeta,
      href: "/pending",
    });
  }

  if (duplicateGroups.length > 0) {
    items.push({
      key: "duplicates",
      tone: "info",
      icon: <Copy className="h-4 w-4" />,
      title: format(
        duplicateGroups.length === 1
          ? t.attention.duplicateOne
          : t.attention.duplicateMany,
        { count: duplicateGroups.length },
      ),
      meta: t.attention.duplicateMeta,
      href: "/duplicates",
    });
  }

  // ── Sponsored slot ──────────────────────────────────────────────────────
  // At most one partner offer, chosen from the same numbers as the list
  // above. Only on the owner's own login: a teammate or accountant acting as
  // the owner must not see offers aimed at the owner or become their lead.
  const userId = session?.user?.id;
  const signals = {
    currency,
    openReceivables: collections?.openTotal ?? 0,
    oldestOpenDays: collections?.agingRows[0]?.daysOutstanding ?? 0,
    vatDue,
    revenueYtd: monthly
      .slice(0, monthIndex + 1)
      .reduce((sum, m) => sum + m.grossRevenue, 0),
  };

  let sponsored =
    userId && !session?.user?.originator
      ? await selectSponsoredOffer(userId, locale, "dashboard", signals).catch(() => null)
      : null;

  const bannerSponsor =
    userId && !session?.user?.originator
      ? await selectSponsoredOffer(userId, locale, "banner", signals).catch(() => null)
      : null;

  // In preview mode, show a demo campaign if none exists
  if (sponsorPreview && !sponsored) {
    sponsored = {
      campaignId: "demo-campaign",
      partnerName: "Premium Accounting",
      partnerMark: "PA",
      ctaUrl: "https://example.com/accounting",
      category: "accountant",
      title: "Get your first month free",
      body: "Let an accountant handle your VAT. We'll match you with a certified professional.",
      cta: "Get Started",
      imageUrl: null,
      trigger: "vat_due",
      reasonVars: { amount: "₪2,450", days: "15" },
      sharedPreview: [
        { field: "name", value: "John Smith" },
        { field: "email", value: "john@example.com" },
      ],
    };
  }

  if (userId && sponsored && sponsored.campaignId !== "demo-campaign") {
    void recordSponsorImpression(userId, sponsored.campaignId);
  }

  if (userId && bannerSponsor && bannerSponsor.campaignId !== "demo-campaign") {
    void recordSponsorImpression(userId, bannerSponsor.campaignId);
  }

  // ── Ranked lists ────────────────────────────────────────────────────────
  // "Who owes you" is a question about people, not documents: three invoices
  // to the same customer are one conversation, so they are rolled up per
  // customer and ranked by amount, with the age of the oldest one as context.
  const owedByCustomer = new Map<
    string,
    { total: number; count: number; oldest: number }
  >();
  for (const row of collections?.agingRows ?? []) {
    const prev = owedByCustomer.get(row.customerName) ?? {
      total: 0,
      count: 0,
      oldest: 0,
    };
    owedByCustomer.set(row.customerName, {
      total:
        prev.total +
        convertAmountBetweenCurrencies(
          Number(row.total),
          row.currency,
          currency,
        ),
      count: prev.count + 1,
      oldest: Math.max(prev.oldest, row.daysOutstanding),
    });
  }
  const owedRows = [...owedByCustomer.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(([name, v]) => ({
      key: name,
      name,
      meta: format(v.count === 1 ? t.owed.metaOne : t.owed.metaMany, {
        count: v.count,
        days: v.oldest,
      }),
      value: v.total,
      valueLabel: formatMoney(v.total, currency),
      href: "/outbound/collections",
    }));

  const vendorRows = (cashflow?.vendors ?? []).map((row, i) => ({
    key: row.vendorId ?? `unassigned-${i}`,
    name: row.vendorName ?? t.frames.unassigned,
    value: row.total,
    valueLabel: formatMoney(row.total, currency),
    href: row.vendorId ? `/vendors/${row.vendorId}` : "/vendors",
  }));

  return (
    <div className="space-y-6">
      <HomePeriodFilter range={range} labels={t.frames} />
      {/* The whole business in one line */}
      <StatBand>
        <BandCell
          label={t.band.in}
          value={formatMoney(moneyIn, currency)}
          icon={<ArrowUpRight className="h-4 w-4" />}
          accent="emerald"
          caption={
            compareLabel ? (
              <Delta current={moneyIn} previous={prevIn} labels={deltaLabels} />
            ) : (
              <span className="text-xs font-medium text-slate-500">
                {t.frames.allTime}
              </span>
            )
          }
          href="/money-in"
        />
        <BandCell
          label={t.band.out}
          value={formatMoney(moneyOut, currency)}
          icon={<ArrowDownRight className="h-4 w-4" />}
          accent="rose"
          caption={
            compareLabel ? (
              <Delta
                current={moneyOut}
                previous={prevOut}
                goodWhenUp={false}
                labels={deltaLabels}
              />
            ) : (
              <span className="text-xs font-medium text-slate-500">
                {t.frames.allTime}
              </span>
            )
          }
          href="/money-out"
        />
        <BandCell
          label={t.band.net}
          value={formatMoney(net, currency)}
          icon={<Wallet className="h-4 w-4" />}
          accent={net >= 0 ? "violet" : "rose"}
          caption={
            <span className="text-xs font-medium text-slate-500">
              {moneyIn > 0 ? format(t.band.margin, { pct: margin }) : t.band.noRevenue}
            </span>
          }
          href="/money-in?tab=profit"
          emphasis
        />
      </StatBand>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title={t.chart.title}
          subtitle={t.frames.chart[range]}
          action={{ href: "/money-in?tab=profit", label: t.chart.action }}
        >
          <CashflowChart
            data={points}
            currency={currency}
            labels={{ income: t.band.in, expense: t.band.out, net: t.band.net }}
            rtl={isRtl}
          />
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title={t.attention.title} subtitle={t.attention.subtitle}>
            <AttentionList
              items={items}
              allClearTitle={t.attention.allClearTitle}
              allClearBody={t.attention.allClearBody}
            />
          </Panel>

          {sponsored ? (
            sponsorPreview ? (
              <SponsorPreviewShowcase offer={sponsored} />
            ) : (
              <SponsoredOffer offer={sponsored} />
            )
          ) : null}

          <Panel title={t.paid.title} subtitle={t.paid.subtitle}>
            <div className="space-y-4 px-5 py-4">
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {collections?.avgCreditDays != null
                  ? format(t.paid.days, { days: collections.avgCreditDays })
                  : t.paid.unknown}
              </p>
              <AgingStrip
                buckets={collections?.agingBuckets ?? null}
                currency={currency}
                labels={t.paid}
              />
            </div>
          </Panel>
        </div>
      </div>

      {bannerSponsor ? <BannerSponsorSlot offer={bannerSponsor} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title={t.owed.title}
          subtitle={t.owed.subtitle}
          action={{ href: "/outbound/collections", label: t.owed.action }}
        >
          <RankList rows={owedRows} tone="attention" emptyLabel={t.owed.empty} />
        </Panel>

        <Panel
          title={t.spend.title}
          subtitle={t.frames.spend[range]}
          action={{ href: "/money-out", label: t.spend.action }}
        >
          <RankList rows={vendorRows} tone="expense" emptyLabel={t.spend.empty} />
        </Panel>
      </div>

    </div>
  );
}

/**
 * Aging of everything still owed, as one stacked strip.
 *
 * Four numbers in a row would be read as four unrelated facts; as segments of
 * a single bar they are read as what they are — the shape of the debt, and how
 * much of it has drifted past the point where it usually gets paid.
 */
function AgingStrip({
  buckets,
  currency,
  labels,
}: {
  buckets: Record<string, { count: number; total: number }> | null;
  currency: string;
  labels: { bucketsTitle: string; noOpen: string };
}) {
  const order = ["0-30", "31-60", "61-90", "90+"] as const;
  const colors: Record<string, string> = {
    "0-30": "bg-emerald-400",
    "31-60": "bg-amber-400",
    "61-90": "bg-orange-400",
    "90+": "bg-rose-500",
  };
  const total = order.reduce((sum, k) => sum + (buckets?.[k]?.total ?? 0), 0);
  if (!buckets || total <= 0) {
    return <p className="text-xs text-slate-400">{labels.noOpen}</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {labels.bucketsTitle}
      </p>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        {order.map((k) =>
          (buckets[k]?.total ?? 0) > 0 ? (
            <span
              key={k}
              className={colors[k]}
              style={{ width: `${((buckets[k].total ?? 0) / total) * 100}%` }}
              title={`${k}: ${formatMoney(buckets[k].total, currency)}`}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {order.map((k) =>
          (buckets[k]?.count ?? 0) > 0 ? (
            <li
              key={k}
              className="inline-flex items-center gap-1.5 text-xs text-slate-600"
            >
              <span className={`h-2 w-2 rounded-full ${colors[k]}`} aria-hidden />
              <span className="tabular-nums">{k}</span>
              <span className="font-semibold tabular-nums text-slate-900">
                {formatMoney(buckets[k].total, currency)}
              </span>
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-slate-100 lg:col-span-2" />
        <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-slate-100"
          />
        ))}
      </div>
    </div>
  );
}
