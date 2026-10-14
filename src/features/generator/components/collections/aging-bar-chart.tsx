"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgingBuckets } from "@/features/generator/actions/collections-actions";

interface AgingBarChartLabels {
  title: string;
  subtitle: string;
  tooltipInvoice: string;
  tooltipInvoices: string;
  tooltipAmount: string;
  tooltipDays: string;
}

interface AgingBarChartProps {
  buckets: AgingBuckets;
  currency: string;
  labels: AgingBarChartLabels;
}

const BUCKET_COLORS: Record<string, string> = {
  "0-30": "#0D9488",
  "31-60": "#F59E0B",
  "61-90": "#F97316",
  "90+": "#DC2626",
};

function currencySymbol(currency: string): string {
  if (currency === "ILS") return "₪";
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return currency;
}

export function AgingBarChart({ buckets, currency, labels }: AgingBarChartProps) {
  const sym = currencySymbol(currency);
  const data = (["0-30", "31-60", "61-90", "90+"] as const).map((key) => ({
    bucket: key,
    count: buckets[key].count,
    total: buckets[key].total,
  }));

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-800">
          {labels.title}
        </CardTitle>
        <p className="text-xs text-slate-500">{labels.subtitle}</p>
      </CardHeader>
      <CardContent>
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 4, right: 12, left: 0, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#e5e7eb"
                vertical={false}
              />
              <XAxis
                dataKey="bucket"
                tick={{ fontSize: 12 }}
                stroke="#9ca3af"
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="#9ca3af"
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
                formatter={(value, name) => {
                  const n = Number(value);
                  if (name === "count")
                    return [n, n === 1 ? labels.tooltipInvoice : labels.tooltipInvoices];
                  return [
                    `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                    labels.tooltipAmount,
                  ];
                }}
                labelFormatter={(label) =>
                  labels.tooltipDays.replace("{label}", String(label ?? ""))
                }
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={56}>
                {data.map((entry) => (
                  <Cell
                    key={entry.bucket}
                    fill={BUCKET_COLORS[entry.bucket] ?? "#0D9488"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {(["0-30", "31-60", "61-90", "90+"] as const).map((key) => (
            <span key={key} className="flex items-center gap-1.5 text-xs text-slate-500">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: BUCKET_COLORS[key] }}
              />
              {key}d
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
