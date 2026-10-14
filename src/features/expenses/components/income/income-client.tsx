"use client";

import { useState, useCallback } from "react";
import { IncomeStatCards } from "./income-stat-cards";
import {
  MonthlyTrendChart,
  type TrendGranularity,
} from "@/features/expenses/components/dashboard/monthly-trend-chart";
import { VendorDonutChart } from "@/features/expenses/components/dashboard/vendor-donut-chart";
import { useT } from "@/lib/i18n/client";
import {
  DashboardFiltersPanel,
  type DashboardFilters,
} from "@/features/expenses/components/dashboard/dashboard-filters";
import { InvoiceTable } from "@/features/expenses/components/invoices/invoice-table";
import type { InvoiceRow } from "@/features/expenses/components/invoices/invoice-columns";

interface IncomeStats {
  totalEarned: number;
  invoiceCount: number;
  monthlyAverage: number;
  runRate: number;
  clientCount: number;
  currency: string;
}

export interface IncomeData {
  stats: IncomeStats;
  trendBuckets: { bucket: string; total: number }[];
  trendGranularity: TrendGranularity;
  clientBreakdown: {
    vendorId: string | null;
    vendorName: string;
    total: number;
  }[];
  invoices: InvoiceRow[];
  clients: { id: string; name: string }[];
}

interface IncomeClientProps {
  initialData: IncomeData;
  fetchIncomeData?: (filters: DashboardFilters) => Promise<IncomeData>;
}

const defaultFilters: DashboardFilters = {
  vendorIds: [],
  timeRange: "last12Months",
  year: null,
  months: [],
  dateFrom: null,
  dateTo: null,
  showWithoutVat: false,
};

export function IncomeClient({
  initialData,
  fetchIncomeData,
}: IncomeClientProps) {
  const charts = useT().dashboard.charts;
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
  const [data, setData] = useState<IncomeData>(initialData);
  const [loading, setLoading] = useState(false);

  const handleFiltersChange = useCallback(
    async (newFilters: DashboardFilters) => {
      setFilters(newFilters);
      if (fetchIncomeData) {
        setLoading(true);
        try {
          const newData = await fetchIncomeData(newFilters);
          setData(newData);
        } catch (error) {
          console.error("Failed to fetch income data:", error);
        } finally {
          setLoading(false);
        }
      }
    },
    [fetchIncomeData]
  );

  const refreshIncomeView = useCallback(async () => {
    if (!fetchIncomeData) return;
    setLoading(true);
    try {
      const newData = await fetchIncomeData(filters);
      setData(newData);
    } catch (error) {
      console.error("Failed to refresh income data:", error);
    } finally {
      setLoading(false);
    }
  }, [fetchIncomeData, filters]);

  return (
    <div className="space-y-6">
      <DashboardFiltersPanel
        vendors={data.clients}
        filters={filters}
        onFiltersChange={handleFiltersChange}
      />

      <div className={loading ? "animate-pulse" : ""}>
        <IncomeStatCards
          totalEarned={data.stats.totalEarned}
          invoiceCount={data.stats.invoiceCount}
          monthlyAverage={data.stats.monthlyAverage}
          runRate={data.stats.runRate}
          clientCount={data.stats.clientCount}
          currency={data.stats.currency}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MonthlyTrendChart
          data={data.trendBuckets}
          currency={data.stats.currency}
          granularity={data.trendGranularity}
          metricLabel="earnings"
          lineColor="#10b981"
          activeDotColor="#059669"
        />
        <VendorDonutChart
          data={data.clientBreakdown}
          currency={data.stats.currency}
          titleText={charts.revenueByClient}
          totalTooltip={charts.totalEarnedTooltip}
          onVendorSelect={(vendorIds) =>
            handleFiltersChange({ ...filters, vendorIds })
          }
        />
      </div>

      <InvoiceTable
        invoices={data.invoices}
        showStatusActions
        onReExtractComplete={
          fetchIncomeData ? refreshIncomeView : undefined
        }
        onAfterBulkMutation={
          fetchIncomeData ? refreshIncomeView : undefined
        }
      />
    </div>
  );
}
