"use client";

import { useState, useCallback } from "react";
import { ProfitStatCards } from "./profit-stat-cards";
import { ProfitTrendChart } from "./profit-trend-chart";
import { ProfitMonthlyTable } from "./profit-monthly-table";
import { ProfitHighlights } from "./profit-highlights";
import {
  ProfitFiltersPanel,
  type ProfitFilters,
} from "./profit-filters";

export interface ProfitData {
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  profitMargin: number;
  incomeCount: number;
  expenseCount: number;
  avgMonthlyProfit: number;
  profitableMonths: number;
  lossMonths: number;
  monthsWithActivity: number;
  bestMonth: {
    month: string;
    income: number;
    expense: number;
    profit: number;
  } | null;
  worstMonth: {
    month: string;
    income: number;
    expense: number;
    profit: number;
  } | null;
  monthlyBreakdown: {
    month: string;
    income: number;
    expense: number;
    profit: number;
  }[];
  currency: string;
}

interface ProfitClientProps {
  initialData: ProfitData;
  fetchProfitData?: (filters: ProfitFilters) => Promise<ProfitData>;
}

const defaultFilters: ProfitFilters = {
  timeRange: "last12Months",
  year: null,
  months: [],
  dateFrom: null,
  dateTo: null,
};

export function ProfitClient({
  initialData,
  fetchProfitData,
}: ProfitClientProps) {
  const [filters, setFilters] = useState<ProfitFilters>(defaultFilters);
  const [data, setData] = useState<ProfitData>(initialData);
  const [loading, setLoading] = useState(false);

  const handleFiltersChange = useCallback(
    async (newFilters: ProfitFilters) => {
      setFilters(newFilters);
      if (fetchProfitData) {
        setLoading(true);
        try {
          const newData = await fetchProfitData(newFilters);
          setData(newData);
        } catch (error) {
          console.error("Failed to fetch profit data:", error);
        } finally {
          setLoading(false);
        }
      }
    },
    [fetchProfitData]
  );

  return (
    <div className="space-y-6">
      <ProfitFiltersPanel
        filters={filters}
        onFiltersChange={handleFiltersChange}
      />

      <div className={loading ? "animate-pulse" : ""}>
        <ProfitStatCards
          totalIncome={data.totalIncome}
          totalExpense={data.totalExpense}
          netProfit={data.netProfit}
          profitMargin={data.profitMargin}
          avgMonthlyProfit={data.avgMonthlyProfit}
          monthsWithActivity={data.monthsWithActivity}
          profitableMonths={data.profitableMonths}
          lossMonths={data.lossMonths}
          currency={data.currency}
        />
      </div>

      <div className={loading ? "animate-pulse" : ""}>
        <ProfitHighlights
          bestMonth={data.bestMonth}
          worstMonth={data.worstMonth}
          currency={data.currency}
          totalIncome={data.totalIncome}
          totalExpense={data.totalExpense}
        />
      </div>

      <div className={loading ? "animate-pulse" : ""}>
        <ProfitTrendChart
          data={data.monthlyBreakdown}
          currency={data.currency}
        />
      </div>

      <div className={loading ? "animate-pulse" : ""}>
        <ProfitMonthlyTable
          data={data.monthlyBreakdown}
          currency={data.currency}
        />
      </div>
    </div>
  );
}
