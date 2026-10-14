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
import { formatCurrency, getCurrencySymbol } from "@/lib/currency";
import { useT } from "@/lib/i18n/client";

interface Invoice {
  invoiceDate: string;
  amount: number;
  currency: string;
}

interface VendorExpenseChartProps {
  invoices: Invoice[];
}

function aggregateByMonth(invoices: Invoice[]) {
  const map = new Map<string, number>();

  for (const inv of invoices) {
    const date = new Date(inv.invoiceDate);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + inv.amount);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => {
      const [y, m] = month.split("-");
      const label = new Date(Number(y), Number(m) - 1).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
      return { month: label, total: Math.round(total * 100) / 100 };
    });
}

function formatAxisValue(value: number, currency: string): string {
  const sym = getCurrencySymbol(currency);
  if (value >= 1000) {
    const k = value / 1000;
    return `${sym}${k >= 100 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${sym}${value.toFixed(0)}`;
}

export function VendorExpenseChart({ invoices }: VendorExpenseChartProps) {
  const t = useT().vendors.detail;
  if (invoices.length === 0) return null;

  const currency = invoices[0].currency;
  const data = aggregateByMonth(invoices);

  if (data.length < 2) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t.expensesOverTime}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12 }}
                stroke="#9ca3af"
              />
              <YAxis
                tickFormatter={(v) => formatAxisValue(Number(v), currency)}
                tick={{ fontSize: 12 }}
                stroke="#9ca3af"
              />
              <Tooltip
                formatter={(value) => [
                  formatCurrency(Number(value), currency),
                  "Expenses",
                ]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                }}
              />
              <Line
                type="monotone"
                dataKey="total"
                stroke="#7c3aed"
                strokeWidth={2}
                dot={{ fill: "#7c3aed", r: 4 }}
                activeDot={{ r: 6, fill: "#4f46e5" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
