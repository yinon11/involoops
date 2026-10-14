"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrencySymbol } from "@/lib/currency";

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface MonthlyTaxChartProps {
  /** 12 data points, one per calendar month. */
  data: { month: number; value: number }[];
  title: string;
  subtitle?: string;
  currency: string;
  /** When true, bars are colored red for negative values (e.g. VAT due). */
  signColored?: boolean;
  /** Bar color for positive values (defaults to the brand violet). */
  positiveColor?: string;
  /** Bar color for negative values when signColored is true. */
  negativeColor?: string;
}

function formatAxisValue(value: number, sym: string): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${sym}${abs.toFixed(0)}`;
}

export function MonthlyTaxChart({
  data,
  title,
  subtitle,
  currency,
  signColored = false,
  positiveColor = "#7C3AED",
  negativeColor = "#DC2626",
}: MonthlyTaxChartProps) {
  const sym = getCurrencySymbol(currency);
  const hasNegative = data.some((d) => d.value < 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-800">
          {title}
        </CardTitle>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </CardHeader>
      <CardContent>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#e5e7eb"
                vertical={false}
              />
              {hasNegative && (
                <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
              )}
              <XAxis
                dataKey="month"
                tickFormatter={(m: number) => MONTH_SHORT[m - 1] ?? ""}
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => formatAxisValue(Number(v), sym)}
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip
                formatter={(value) => [
                  `${sym}${Number(value).toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}`,
                  title,
                ]}
                labelFormatter={(label) =>
                  MONTH_SHORT[Number(label) - 1] ?? String(label)
                }
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={40}>
                {data.map((entry) => (
                  <Cell
                    key={entry.month}
                    fill={
                      signColored && entry.value < 0
                        ? negativeColor
                        : positiveColor
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
