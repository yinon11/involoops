"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency, getCurrencySymbol } from "@/lib/currency";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries";

const MONTH_KEYS: (keyof Dictionary["profit"]["monthsLong"])[] = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

interface ProfitTrendChartProps {
  data: {
    month: string;
    income: number;
    expense: number;
    profit: number;
  }[];
  currency: string;
}

function formatTick(
  bucket: string,
  monthsShort: Dictionary["profit"]["monthsShort"],
): string {
  // bucket: YYYY-MM → "MMM YY"
  const [y, m] = bucket.split("-");
  const monthIdx = parseInt(m, 10) - 1;
  const key = MONTH_KEYS[monthIdx];
  const name = key ? monthsShort[key] : "";
  return `${name} ${y.slice(2)}`;
}

function formatTooltipLabel(
  bucket: string,
  monthsLong: Dictionary["profit"]["monthsLong"],
): string {
  const [y, m] = bucket.split("-");
  const monthIdx = parseInt(m, 10) - 1;
  const key = MONTH_KEYS[monthIdx];
  const name = key ? monthsLong[key] : "";
  return `${name} ${y}`;
}

function formatAxisValue(value: number, currency: string): string {
  const sym = getCurrencySymbol(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1000) {
    const k = abs / 1000;
    const n = k >= 100 ? k.toFixed(0) : k.toFixed(1);
    return `${sign}${sym}${n}k`;
  }
  return `${sign}${sym}${abs.toFixed(0)}`;
}

export function ProfitTrendChart({ data, currency }: ProfitTrendChartProps) {
  const { dict } = useI18n();
  const t = dict.profit.trend;
  const monthsShort = dict.profit.monthsShort;
  const monthsLong = dict.profit.monthsLong;

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">
            {t.titleEmpty}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            {t.empty}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{t.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12 }}
                stroke="#9ca3af"
                tickFormatter={(v) => formatTick(String(v), monthsShort)}
              />
              <YAxis
                tickFormatter={(v) => formatAxisValue(Number(v), currency)}
                tick={{ fontSize: 12 }}
                stroke="#9ca3af"
              />
              <Tooltip
                formatter={(value, name) => [
                  formatCurrency(Number(value), currency),
                  name,
                ]}
                labelFormatter={(label) =>
                  formatTooltipLabel(String(label ?? ""), monthsLong)
                }
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                }}
              />
              <Legend
                wrapperStyle={{ paddingTop: 10 }}
                iconType="circle"
              />
              <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="2 2" />
              <Bar
                dataKey="income"
                name={t.seriesIncome}
                fill="#10b981"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Bar
                dataKey="expense"
                name={t.seriesExpenses}
                fill="#f43f5e"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Line
                type="monotone"
                dataKey="profit"
                name={t.seriesProfit}
                stroke="#6366f1"
                strokeWidth={3}
                dot={{ fill: "#6366f1", r: 4 }}
                activeDot={{ r: 6, fill: "#4338ca" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
