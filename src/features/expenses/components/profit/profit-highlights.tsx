"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/currency";
import { Trophy, AlertTriangle, PiggyBank, TrendingDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries";

interface MonthlyRow {
  month: string;
  income: number;
  expense: number;
  profit: number;
}

interface ProfitHighlightsProps {
  bestMonth: MonthlyRow | null;
  worstMonth: MonthlyRow | null;
  currency: string;
  totalIncome: number;
  totalExpense: number;
}

const MONTH_KEYS: (keyof Dictionary["profit"]["monthsLong"])[] = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function formatMonth(
  bucket: string,
  monthsLong: Dictionary["profit"]["monthsLong"],
): string {
  const [y, m] = bucket.split("-");
  const idx = parseInt(m, 10) - 1;
  const key = MONTH_KEYS[idx];
  const name = key ? monthsLong[key] : "";
  return `${name} ${y}`;
}

export function ProfitHighlights({
  bestMonth,
  worstMonth,
  currency,
  totalIncome,
  totalExpense,
}: ProfitHighlightsProps) {
  const { dict } = useI18n();
  const t = dict.profit.highlights;
  const monthsLong = dict.profit.monthsLong;
  const expenseRatio =
    totalIncome > 0 ? (totalExpense / totalIncome) * 100 : null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Best month */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-emerald-500" />
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t.bestMonth}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {bestMonth && bestMonth.profit > 0 ? (
            <>
              <p className="text-xl font-bold">
                {formatMonth(bestMonth.month, monthsLong)}
              </p>
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
                {t.profitWithAmount.replace(
                  "{amount}",
                  formatCurrency(bestMonth.profit, currency),
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t.inOutSummary
                  .replace(
                    "{income}",
                    formatCurrency(bestMonth.income, currency),
                  )
                  .replace(
                    "{expense}",
                    formatCurrency(bestMonth.expense, currency),
                  )}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t.noProfitableMonths}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Worst month */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            {worstMonth && worstMonth.profit < 0 ? (
              <AlertTriangle className="h-4 w-4 text-rose-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-amber-500" />
            )}
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {worstMonth && worstMonth.profit < 0
                ? t.worstMonth
                : t.lowestMonth}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {worstMonth ? (
            <>
              <p className="text-xl font-bold">
                {formatMonth(worstMonth.month, monthsLong)}
              </p>
              <p
                className={`mt-1 text-sm ${
                  worstMonth.profit < 0
                    ? "text-rose-700 dark:text-rose-400"
                    : "text-amber-700 dark:text-amber-400"
                }`}
              >
                {(worstMonth.profit < 0
                  ? t.lossWithAmount
                  : t.profitWithAmount
                ).replace(
                  "{amount}",
                  formatCurrency(worstMonth.profit, currency),
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t.inOutSummary
                  .replace(
                    "{income}",
                    formatCurrency(worstMonth.income, currency),
                  )
                  .replace(
                    "{expense}",
                    formatCurrency(worstMonth.expense, currency),
                  )}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t.noActivity}</p>
          )}
        </CardContent>
      </Card>

      {/* Expense ratio */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <PiggyBank className="h-4 w-4 text-indigo-500" />
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t.expenseRatio}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {expenseRatio === null ? (
            <p className="text-sm text-muted-foreground">
              {t.expenseRatioNoIncome}
            </p>
          ) : (
            <>
              <p className="text-xl font-bold">
                {expenseRatio.toFixed(1)}%
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.expenseRatioCaption}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full transition-all ${
                    expenseRatio <= 70
                      ? "bg-emerald-500"
                      : expenseRatio <= 95
                        ? "bg-amber-500"
                        : "bg-rose-500"
                  }`}
                  style={{ width: `${Math.min(100, expenseRatio)}%` }}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
