"use client";

import { Flame, TrendingUp, Wallet } from "lucide-react";
import { BandCell, StatBand } from "@/components/dashboard/primitives";
import { formatCurrencyCompact } from "@/lib/currency";
import { useT } from "@/lib/i18n/client";

export interface StatCardsValues {
  totalSpent: number;
  invoiceCount: number;
  monthlyAverage: number;
  burnRate: number;
  vendorCount: number;
  llmTotalCostUsd: number;
  llmTotalTokens: number;
  currency: string;
}

interface StatCardsProps extends StatCardsValues {
  /**
   * Optional second dataset. When present each figure splits into an A/B pair
   * so the compare view can be read without scrolling between two bands.
   */
  compare?: StatCardsValues;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

/**
 * The headline of the expenses dashboard: three figures, same strip as Home.
 *
 * It was five saturated gradient cards, each a different hue, so every number
 * shouted equally and no colour was left to mean anything. Two of the five
 * were not business facts at all — a repeat of the invoice count already
 * printed under "total spent", and the cost of AI extraction. Those are true
 * and worth showing, so they moved to the caption line underneath, where a
 * detail belongs.
 */
export function StatCards({ compare, ...values }: StatCardsProps) {
  const t = useT().dashboard.stats;
  const isCompare = compare !== undefined;

  const money = (v: StatCardsValues, key: "totalSpent" | "monthlyAverage" | "burnRate") =>
    formatCurrencyCompact(v[key], v.currency);

  const cell = (key: "totalSpent" | "monthlyAverage" | "burnRate") =>
    isCompare ? (
      <ABPair a={money(values, key)} b={money(compare, key)} />
    ) : (
      money(values, key)
    );

  return (
    <div className="space-y-2">
      <StatBand>
        <BandCell
          label={t.totalSpent}
          value={cell("totalSpent")}
          icon={<Wallet className="h-4 w-4" />}
          accent="rose"
          emphasis={!isCompare}
          caption={
            <span className="text-xs text-slate-500">
              {t.totalSpentSubtitle.replace(
                "{count}",
                values.invoiceCount.toString(),
              )}
            </span>
          }
        />
        <BandCell
          label={t.monthlyAverage}
          value={cell("monthlyAverage")}
          icon={<TrendingUp className="h-4 w-4" />}
          accent="violet"
          caption={
            <span className="text-xs text-slate-500">
              {t.monthlyAverageSubtitle}
            </span>
          }
        />
        <BandCell
          label={t.burnRate}
          value={cell("burnRate")}
          icon={<Flame className="h-4 w-4" />}
          accent="amber"
          caption={
            <span className="text-xs text-slate-500">{t.burnRateSubtitle}</span>
          }
        />
      </StatBand>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-slate-400">
        <span>
          {values.vendorCount} {t.vendors.toLowerCase()}
        </span>
        <span aria-hidden>·</span>
        <span>
          {t.llmCost}: ${values.llmTotalCostUsd.toFixed(4)} ·{" "}
          {t.llmCostSubtitle.replace(
            "{tokens}",
            formatTokenCount(values.llmTotalTokens),
          )}
        </span>
      </p>
    </div>
  );
}

/** Two values side by side under one label, for the compare view. */
function ABPair({ a, b }: { a: string; b: string }) {
  return (
    <span className="grid grid-cols-2 gap-2 divide-x divide-slate-100 rtl:divide-x-reverse">
      <span className="min-w-0 pe-2">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          A
        </span>
        <span className="block truncate text-xl font-semibold text-slate-900">
          {a}
        </span>
      </span>
      <span className="min-w-0 ps-2">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          B
        </span>
        <span className="block truncate text-xl font-semibold text-slate-900">
          {b}
        </span>
      </span>
    </span>
  );
}
