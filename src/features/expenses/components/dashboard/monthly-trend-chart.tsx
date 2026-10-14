"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/currency";
import { useI18n } from "@/lib/i18n/client";

export type TrendGranularity = "day" | "month";

interface MonthlyTrendChartProps {
  data: { bucket: string; total: number }[];
  /** Dashboard display currency (aggregated totals). */
  currency: string;
  /**
   * Whether each bucket represents a day (YYYY-MM-DD) or a month (YYYY-MM).
   * Picked by the server based on the selected period — periods shorter than
   * two months render as days, longer ones as months.
   */
  granularity: TrendGranularity;
  /**
   * Metric word used in the card title ("<metric> Trend") and the tooltip
   * label. Defaults to "spending" so the dashboard keeps its original copy;
   * reused by the income page as "earnings". Used to look up the localized
   * label and to insert into the title template.
   */
  metricLabel?: "spending" | "earnings";
  /** Line / dot color. Defaults to the dashboard's purple. */
  lineColor?: string;
  /** Hover dot color. Defaults to a slightly darker shade of the dashboard purple. */
  activeDotColor?: string;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Compact axis tick: `18k`, `1.4M` — currency-free on purpose.
 *
 * Symbol placement is locale-dependent (the shekel trails in he-IL, the dollar
 * leads in en-US), so a hand-built `${sym}${n}k` contradicts every other
 * amount on the page in Hebrew. The card title and the tooltip both name the
 * currency, so the axis does not need to.
 */
function formatAxisValue(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

function formatTick(bucket: string, granularity: TrendGranularity): string {
  if (granularity === "day") {
    // bucket: YYYY-MM-DD → "D MMM" (e.g. "5 Apr")
    const [, m, d] = bucket.split("-");
    const monthIdx = parseInt(m, 10) - 1;
    const day = parseInt(d, 10);
    return `${day} ${MONTH_SHORT[monthIdx] ?? ""}`;
  }
  // bucket: YYYY-MM → "MMM YY" (e.g. "Apr 26")
  const [y, m] = bucket.split("-");
  const monthIdx = parseInt(m, 10) - 1;
  return `${MONTH_SHORT[monthIdx] ?? ""} ${y.slice(2)}`;
}

function formatTooltipLabel(
  bucket: string,
  granularity: TrendGranularity,
): string {
  if (granularity === "day") {
    const [y, m, d] = bucket.split("-");
    const monthIdx = parseInt(m, 10) - 1;
    return `${parseInt(d, 10)} ${MONTH_LONG[monthIdx] ?? ""} ${y}`;
  }
  const [y, m] = bucket.split("-");
  const monthIdx = parseInt(m, 10) - 1;
  return `${MONTH_LONG[monthIdx] ?? ""} ${y}`;
}

export function MonthlyTrendChart({
  data,
  currency,
  granularity,
  metricLabel = "spending",
  lineColor = "#7c3aed",
  activeDotColor = "#4f46e5",
}: MonthlyTrendChartProps) {
  const { dict, dir } = useI18n();
  const t = dict.dashboard.charts;
  // In Hebrew the page reads right to left, so time has to as well: the axis
  // moves to the right edge and the series is plotted in reverse.
  const isRtl = dir === "rtl";
  const metricText = metricLabel === "earnings" ? t.earnings : t.spending;
  const title =
    granularity === "day"
      ? t.dailyMetricTrend.replace("{metric}", metricText)
      : t.monthlyMetricTrend.replace("{metric}", metricText);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="bucket"
                reversed={isRtl}
                tick={{ fontSize: 12 }}
                stroke="#9ca3af"
                tickFormatter={(value: string) => formatTick(value, granularity)}
              />
              <YAxis
                orientation={isRtl ? "right" : "left"}
                tickFormatter={(v) => formatAxisValue(Number(v))}
                tick={{ fontSize: 12 }}
                stroke="#9ca3af"
              />
              <Tooltip
                formatter={(value) => [
                  formatCurrency(Number(value), currency),
                  metricText,
                ]}
                labelFormatter={(label) =>
                  formatTooltipLabel(String(label ?? ""), granularity)
                }
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                }}
              />
              <Line
                type="monotone"
                dataKey="total"
                stroke={lineColor}
                strokeWidth={2}
                dot={{ fill: lineColor, r: 4 }}
                activeDot={{ r: 6, fill: activeDotColor }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
