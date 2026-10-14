"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { formatMoney } from "./primitives";

export interface ShareSlice {
  id: string | null;
  name: string;
  total: number;
}

/**
 * Categorical palette — the same eight validated hues the vendor donut uses,
 * in the same fixed order, so "who pays me" and "who I pay" are read with one
 * visual vocabulary.
 *
 * Validated as a set on a white surface: worst adjacent CVD deltaE 9.1, worst
 * adjacent normal-vision deltaE 19.6. Three slots sit below 3:1 contrast, so
 * the legend beside the ring names and prices every slice — identity is never
 * carried by colour alone.
 */
const COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
] as const;

/** The aggregated tail is neutral: "Other" is a bucket, not an identity. */
const OTHER_COLOR = "#94a3b8";

/**
 * Part-to-whole at a glance: where the money comes from, or where it goes.
 *
 * A ring rather than a pie so the total can live in the middle, and capped at
 * eight arcs because past that adjacent slices stop being separable and the
 * form stops answering its question. Every arc is also a legend row with its
 * name and amount, which is both the colour-contrast relief and the table view.
 */
export function ShareDonut({
  slices,
  currency,
  totalLabel,
  emptyLabel,
  otherLabel,
}: {
  slices: ShareSlice[];
  currency: string;
  totalLabel: string;
  emptyLabel: string;
  otherLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const sorted = [...slices].sort((a, b) => b.total - a.total);
  const shown =
    sorted.length <= COLORS.length
      ? sorted
      : [
          ...sorted.slice(0, COLORS.length - 1),
          {
            id: null,
            name: otherLabel,
            total: sorted
              .slice(COLORS.length - 1)
              .reduce((sum, s) => sum + s.total, 0),
          },
        ];

  const total = shown.reduce((sum, s) => sum + s.total, 0);

  if (total <= 0) {
    return (
      <p className="px-5 py-16 text-center text-sm text-slate-400">{emptyLabel}</p>
    );
  }

  const colorFor = (index: number, id: string | null) =>
    id === null && index === shown.length - 1 && shown.length === COLORS.length
      ? OTHER_COLOR
      : (COLORS[index] ?? OTHER_COLOR);

  return (
    /* Ring above, legend below — always. Side by side would leave the legend
       about 140px in this panel, which truncates every customer name to four
       characters, and a legend you cannot read is the whole chart's relief
       for the three palette slots that sit under 3:1 contrast. */
    <div className="flex flex-col items-center gap-4 px-5 py-5">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown}
              dataKey="total"
              nameKey="name"
              innerRadius={58}
              outerRadius={92}
              /* A 2px surface gap separates arcs — a stroke around each mark
                 would be border ink doing a spacer's job. */
              paddingAngle={2}
              stroke="#ffffff"
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={(_, index) => setActive(index)}
              onMouseLeave={() => setActive(null)}
            >
              {shown.map((slice, index) => (
                <Cell
                  key={slice.id ?? `slice-${index}`}
                  fill={colorFor(index, slice.id)}
                  opacity={active === null || active === index ? 1 : 0.45}
                  style={{ transition: "opacity 120ms", cursor: "default" }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {active === null ? totalLabel : ""}
          </span>
          <span className="max-w-[120px] truncate text-lg font-semibold text-slate-900">
            {formatMoney(active === null ? total : shown[active].total, currency)}
          </span>
          {active === null ? null : (
            <span className="max-w-[120px] truncate text-[11px] text-slate-500">
              {shown[active].name}
            </span>
          )}
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-1.5">
        {shown.map((slice, index) => (
          <li
            key={slice.id ?? `legend-${index}`}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(null)}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-slate-50"
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: colorFor(index, slice.id) }}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
              {slice.name}
            </span>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-900">
              {formatMoney(slice.total, currency)}
            </span>
            <span className="w-9 shrink-0 text-end text-[11px] tabular-nums text-slate-400">
              {Math.round((slice.total / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
