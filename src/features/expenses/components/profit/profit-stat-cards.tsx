"use client";

import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/currency";
import {
  ArrowUpRight,
  ArrowDownRight,
  Scale,
  Percent,
  Calendar,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

export interface ProfitStatCardsValues {
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  profitMargin: number;
  avgMonthlyProfit: number;
  monthsWithActivity: number;
  profitableMonths: number;
  lossMonths: number;
  currency: string;
}

export function ProfitStatCards(values: ProfitStatCardsValues) {
  const { dict } = useI18n();
  const t = dict.profit.stats;
  const profitPositive = values.netProfit >= 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {/* Income */}
      <Card className="border-0 bg-gradient-to-br from-emerald-500 to-emerald-700 text-white">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-white/80">
              {t.totalIncome}
            </p>
            <ArrowUpRight className="h-5 w-5 text-white/60" />
          </div>
          <p className="mt-2 text-2xl font-bold">
            {formatCurrency(values.totalIncome, values.currency)}
          </p>
          <p className="mt-1 text-sm text-white/70">{t.totalIncomeSubtitle}</p>
        </div>
      </Card>

      {/* Expenses */}
      <Card className="border-0 bg-gradient-to-br from-rose-500 to-rose-700 text-white">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-white/80">
              {t.totalExpenses}
            </p>
            <ArrowDownRight className="h-5 w-5 text-white/60" />
          </div>
          <p className="mt-2 text-2xl font-bold">
            {formatCurrency(values.totalExpense, values.currency)}
          </p>
          <p className="mt-1 text-sm text-white/70">{t.totalExpensesSubtitle}</p>
        </div>
      </Card>

      {/* Net Profit */}
      <Card
        className={`border-0 bg-gradient-to-br text-white ${
          profitPositive
            ? "from-indigo-600 to-indigo-800"
            : "from-orange-500 to-orange-700"
        }`}
      >
        <div className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-white/80">
              {t.netProfit}
            </p>
            <Scale className="h-5 w-5 text-white/60" />
          </div>
          <p className="mt-2 text-2xl font-bold">
            {formatCurrency(values.netProfit, values.currency)}
          </p>
          <p className="mt-1 text-sm text-white/70">
            {profitPositive ? t.netProfitPositive : t.netProfitNegative}
          </p>
        </div>
      </Card>

      {/* Profit Margin */}
      <Card
        className={`border-0 bg-gradient-to-br text-white ${
          profitPositive
            ? "from-purple-600 to-purple-800"
            : "from-amber-500 to-amber-700"
        }`}
      >
        <div className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-white/80">
              {t.profitMargin}
            </p>
            <Percent className="h-5 w-5 text-white/60" />
          </div>
          <p className="mt-2 text-2xl font-bold">
            {values.profitMargin.toFixed(1)}%
          </p>
          <p className="mt-1 text-sm text-white/70">
            {values.totalIncome > 0
              ? t.profitMarginRatio
              : t.profitMarginNoIncome}
          </p>
        </div>
      </Card>

      {/* Monthly Average */}
      <Card className="border-0 bg-gradient-to-br from-slate-700 to-slate-900 text-white">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-white/80">
              {t.avgMonthlyProfit}
            </p>
            <Calendar className="h-5 w-5 text-white/60" />
          </div>
          <p className="mt-2 text-2xl font-bold">
            {formatCurrency(values.avgMonthlyProfit, values.currency)}
          </p>
          <p className="mt-1 text-sm text-white/70">
            {t.profitableLossSplit
              .replace("{profitable}", String(values.profitableMonths))
              .replace("{loss}", String(values.lossMonths))}
          </p>
        </div>
      </Card>
    </div>
  );
}
