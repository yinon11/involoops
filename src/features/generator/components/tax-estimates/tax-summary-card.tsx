"use client";

import { getCurrencySymbol } from "@/lib/currency";

type Tone = "green" | "amber" | "red" | "slate";

interface TaxSummaryCardProps {
  label: string;
  value: number;
  /** When true, a negative value is displayed as a refund label in green. */
  isMonetary?: boolean;
  currency?: string;
  subtitle?: string;
  tone: Tone;
  /** Small icon node (Lucide). */
  icon?: React.ReactNode;
  /** Translated "REFUND" string. */
  refundLabel?: string;
}

const TONE_ICON: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100",
  amber: "bg-amber-50 text-amber-600 ring-1 ring-amber-100",
  red: "bg-red-50 text-red-600 ring-1 ring-red-100",
  slate: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
};
const TONE_ACCENT: Record<Tone, string> = {
  green: "from-emerald-400/70 to-emerald-600/70",
  amber: "from-amber-400/70 to-amber-600/70",
  red: "from-red-400/70 to-red-600/70",
  slate: "from-slate-300/60 to-slate-200/60",
};
const TONE_VALUE: Record<Tone, string> = {
  green: "text-emerald-700",
  amber: "text-amber-800",
  red: "text-red-700",
  slate: "text-slate-900",
};

export function TaxSummaryCard({
  label,
  value,
  isMonetary = true,
  currency = "ILS",
  subtitle,
  tone,
  icon,
  refundLabel = "REFUND",
}: TaxSummaryCardProps) {
  const sym = getCurrencySymbol(currency);
  const isRefund = isMonetary && value < 0;

  let displayValue: string;
  if (!isMonetary) {
    displayValue = value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  } else if (isRefund) {
    displayValue = `${sym}${Math.abs(value).toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })} ${refundLabel}`;
  } else {
    displayValue = `${sym}${value.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`;
  }

  const effectiveTone: Tone = isRefund ? "green" : tone;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${TONE_ACCENT[effectiveTone]}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </p>
          <p
            className={`mt-3 truncate text-2xl font-semibold tabular-nums ${TONE_VALUE[effectiveTone]}`}
          >
            {displayValue}
          </p>
          {subtitle && (
            <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>
          )}
        </div>
        {icon && (
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_ICON[effectiveTone]}`}
          >
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}
