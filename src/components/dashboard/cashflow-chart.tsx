"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatAxisNumber, formatMoney } from "./primitives";

export interface CashflowPoint {
  /** Pre-formatted axis label — the server owns month naming and locale. */
  label: string;
  income: number;
  expense: number;
  net: number;
}

/**
 * Twelve months of money in, money out and what was left.
 *
 * Paired bars rather than a stack: the question the page answers is "did I
 * earn more than I spent", and a stack makes that comparison impossible. The
 * net line sits on the same axis so a month where the line dips under the
 * bars is immediately legible as a loss.
 *
 * All labels arrive as props — this component is deliberately i18n-free so it
 * can be dropped into any locale without a second dictionary lookup.
 */
export function CashflowChart({
  data,
  currency,
  labels,
  rtl = false,
  series = ["income", "expense", "net"],
}: {
  data: CashflowPoint[];
  currency: string;
  labels: { income: string; expense: string; net: string };
  /** Mirror the plot for right-to-left locales: time runs right to left. */
  rtl?: boolean;
  /**
   * Which series to draw. Home plots all three; the income overview plots
   * only what was billed, and a single series needs no legend — the panel
   * title already names it.
   */
  series?: ("income" | "expense" | "net")[];
}) {
  const show = (key: "income" | "expense" | "net") => series.includes(key);
  return (
    <div className="px-2 pb-4 pt-5">
      {series.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center gap-4 px-3">
          {show("income") ? (
            <LegendSwatch className="bg-emerald-500" label={labels.income} />
          ) : null}
          {show("expense") ? (
            <LegendSwatch className="bg-rose-400" label={labels.expense} />
          ) : null}
          {show("net") ? (
            <LegendSwatch className="bg-violet-600" label={labels.net} line />
          ) : null}
        </div>
      ) : null}
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 12, bottom: 0, left: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="label"
              reversed={rtl}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "#64748b" }}
            />
            <YAxis
              orientation={rtl ? "right" : "left"}
              tickLine={false}
              axisLine={false}
              width={46}
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              tickFormatter={(v: number) => formatAxisNumber(v)}
            />
            <Tooltip
              cursor={{ fill: "rgba(148,163,184,0.10)" }}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                fontSize: 12,
              }}
              formatter={(value, key) => [
                formatMoney(Number(value ?? 0), currency),
                key === "income"
                  ? labels.income
                  : key === "expense"
                    ? labels.expense
                    : labels.net,
              ]}
            />
            {show("income") ? (
              <Bar
                dataKey="income"
                fill="#10b981"
                radius={[4, 4, 0, 0]}
                maxBarSize={series.length > 1 ? 18 : 30}
              />
            ) : null}
            {show("expense") ? (
              <Bar dataKey="expense" fill="#fb7185" radius={[4, 4, 0, 0]} maxBarSize={18} />
            ) : null}
            {show("net") ? (
              <Line
                type="monotone"
                dataKey="net"
                stroke="#7c3aed"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LegendSwatch({
  className,
  label,
  line = false,
}: {
  className: string;
  label: string;
  line?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <span
        aria-hidden
        className={`${className} ${line ? "h-0.5 w-4 rounded-full" : "h-2.5 w-2.5 rounded-sm"}`}
      />
      {label}
    </span>
  );
}
