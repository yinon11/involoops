import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatCurrencyCompact } from "@/lib/currency";

/**
 * Shared dashboard vocabulary — used by Home, Income overview and Expenses
 * overview so the three pages read as one product.
 *
 * Two rules keep it coherent:
 *
 *   1. Surfaces are neutral. Every card is white on slate; colour is reserved
 *      for *meaning* (emerald = money in / healthy, rose = money out / late,
 *      amber = needs a decision, violet = the brand's primary action). A card
 *      that is entirely filled with colour cannot say anything with colour.
 *   2. The number comes first, the label above it, the context below it. A
 *      figure with no comparison is trivia, so every tile can carry a delta.
 */

/** Money for dashboards: no cents, same symbol placement as everywhere else. */
export const formatMoney = formatCurrencyCompact;

/**
 * Compact axis tick: `18k`, `1.4M`.
 *
 * Deliberately currency-free. Symbol placement is locale-dependent (₪ trails
 * in he-IL, $ leads in en-US) and the compact ICU forms carry bidi marks that
 * render as visible clutter on an axis; the tooltip and the surrounding tiles
 * already say which currency this is.
 */
export function formatAxisNumber(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

export type Tone = "income" | "expense" | "neutral" | "attention" | "brand";

const TONE_ICON: Record<Tone, string> = {
  income: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  expense: "bg-rose-50 text-rose-600 ring-rose-100",
  neutral: "bg-slate-100 text-slate-500 ring-slate-200",
  attention: "bg-amber-50 text-amber-600 ring-amber-100",
  brand: "bg-violet-50 text-violet-600 ring-violet-100",
};

/**
 * Percentage change against a previous period.
 *
 * `goodWhenUp` flips the colouring: spending 12% more is not good news, so the
 * expenses side passes `false` and the same arrow turns rose.
 */
export function Delta({
  current,
  previous,
  goodWhenUp = true,
  labels,
}: {
  current: number;
  previous: number;
  goodWhenUp?: boolean;
  labels: { up: string; down: string; flat: string; noPrior: string };
}) {
  if (previous === 0) {
    return (
      <span className="text-xs font-medium text-slate-400">
        {current === 0 ? labels.flat : labels.noPrior}
      </span>
    );
  }
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
        <Minus className="h-3 w-3" aria-hidden />
        {labels.flat}
      </span>
    );
  }
  const up = pct > 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
      )}
    >
      <Icon className="h-3 w-3 shrink-0 rtl:-scale-x-100" aria-hidden />
      {Math.abs(pct)}%
      <span className="font-normal opacity-70">
        {up ? labels.up : labels.down}
      </span>
    </span>
  );
}

/**
 * One number with its label, optional trend and optional destination.
 * Renders as a link when `href` is given so every figure is a way in.
 */
export function StatTile({
  label,
  value,
  caption,
  icon,
  tone = "neutral",
  href,
  footer,
  emphasis = false,
}: {
  label: string;
  value: string;
  caption?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  href?: string;
  footer?: ReactNode;
  /** Larger figure — for the one number the page is really about. */
  emphasis?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </p>
        {icon ? (
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1",
              TONE_ICON[tone],
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-2 font-semibold tabular-nums text-slate-900",
          emphasis ? "text-3xl" : "text-2xl",
        )}
      >
        {value}
      </p>
      {caption ? <div className="mt-1.5 text-xs text-slate-500">{caption}</div> : null}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </>
  );

  const shell =
    "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all";

  if (!href) return <div className={shell}>{body}</div>;
  return (
    <Link
      href={href}
      className={cn(
        shell,
        "group block hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md",
      )}
    >
      {body}
    </Link>
  );
}

/** A titled white panel with an optional "see all" link in the header. */
export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: { href: string; label: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          ) : null}
        </div>
        {action ? (
          <Link
            href={action.href}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-700 transition-colors hover:text-violet-800"
          >
            {action.label}
            <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Ranked list with a share bar under each row — "where the money goes" and
 * "who owes you" read the same way, so they use the same component.
 *
 * The bar sits below the label rather than behind it. A tinted block behind
 * the text turns a five-row list into a checkerboard and makes the names
 * harder to read, which defeats the point of naming them.
 */
export function RankList({
  rows,
  tone,
  emptyLabel,
}: {
  rows: {
    key: string;
    name: string;
    meta?: string;
    value: number;
    valueLabel: string;
    href?: string;
  }[];
  tone: Extract<Tone, "income" | "expense" | "attention">;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-slate-400">{emptyLabel}</p>
    );
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const bar: Record<typeof tone, string> = {
    income: "bg-emerald-500",
    expense: "bg-rose-400",
    attention: "bg-amber-400",
  };

  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row) => {
        const width = `${Math.max(2, (Math.abs(row.value) / max) * 100)}%`;
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 truncate text-sm font-medium text-slate-800">
                {row.name}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                {row.valueLabel}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <span
                aria-hidden
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"
              >
                <span
                  className={cn("block h-full rounded-full", bar[tone])}
                  style={{ width }}
                />
              </span>
              {row.meta ? (
                <span className="shrink-0 text-xs text-slate-500">{row.meta}</span>
              ) : null}
            </div>
          </>
        );
        return (
          <li key={row.key}>
            {row.href ? (
              <Link
                href={row.href}
                className="block px-5 py-3 transition-colors hover:bg-slate-50"
              >
                {inner}
              </Link>
            ) : (
              <div className="px-5 py-3">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The headline strip: two to four figures that together are the page's answer.
 *
 * One card split by hairlines rather than separate cards, because the figures
 * are parts of a single statement ("this came in, that went out, this is what
 * is left") and separate cards would read as unrelated facts.
 */
export function StatBand({ children }: { children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse">
      {children}
    </section>
  );
}

export function BandCell({
  label,
  value,
  icon,
  accent,
  caption,
  href,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  accent: "emerald" | "rose" | "violet" | "amber" | "slate";
  caption?: ReactNode;
  href?: string;
  /** The one figure the band is really about — tinted and a size larger. */
  emphasis?: boolean;
}) {
  const ring: Record<typeof accent, string> = {
    emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    rose: "bg-rose-50 text-rose-600 ring-rose-100",
    violet: "bg-violet-50 text-violet-600 ring-violet-100",
    amber: "bg-amber-50 text-amber-600 ring-amber-100",
    slate: "bg-slate-100 text-slate-500 ring-slate-200",
  };
  const inner = (
    <>
      <span className="flex items-center gap-2">
        {icon ? (
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${ring[accent]}`}
          >
            {icon}
          </span>
        ) : null}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </span>
      {/* Proportional figures: equal-width digits make a display-size number
          look loose. `tabular-nums` belongs in tables and on axes. */}
      <span
        className={cn(
          "font-semibold leading-none text-slate-900",
          emphasis ? "text-[2.25rem]" : "text-3xl",
        )}
      >
        {value}
      </span>
      {caption ? (
        <span className="flex min-h-[1.25rem] items-center">{caption}</span>
      ) : null}
    </>
  );

  const shell = cn(
    "flex flex-col gap-2 px-6 py-5 transition-colors",
    emphasis && "bg-violet-50/40",
  );

  if (!href) return <div className={shell}>{inner}</div>;
  return (
    <Link href={href} className={cn(shell, "group hover:bg-slate-50/70")}>
      {inner}
    </Link>
  );
}
