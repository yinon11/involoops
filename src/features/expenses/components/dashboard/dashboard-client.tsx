"use client";

import { useState, useCallback, useMemo } from "react";
import { StatCards } from "./stat-cards";
import { MonthlyTrendChart, type TrendGranularity } from "./monthly-trend-chart";
import {
  VendorDonutChart,
  buildVendorComparisonColorMap,
} from "./vendor-donut-chart";
import { VendorComparisonChart } from "./vendor-comparison-chart";
import {
  DashboardFiltersPanel,
  type DashboardFilters,
} from "./dashboard-filters";
import { summarizeFilters } from "./filter-summary";
import { InvoiceTable } from "@/features/expenses/components/invoices/invoice-table";
import type { InvoiceRow } from "@/features/expenses/components/invoices/invoice-columns";
import { PlanUsageCard } from "@/components/settings/plan-usage-card";
import type { PlanInfo, AvailableTier } from "@/actions/subscription-actions";

interface DashboardStats {
  totalSpent: number;
  invoiceCount: number;
  monthlyAverage: number;
  burnRate: number;
  vendorCount: number;
  llmTotalCostUsd: number;
  llmTotalTokens: number;
  currency: string;
}

interface DashboardData {
  stats: DashboardStats;
  trendBuckets: { bucket: string; total: number }[];
  trendGranularity: TrendGranularity;
  vendorBreakdown: { vendorId: string | null; vendorName: string; total: number }[];
  invoices: InvoiceRow[];
  vendors: { id: string; name: string }[];
}

interface DashboardClientProps {
  initialData: DashboardData;
  fetchDashboardData?: (
    filters: DashboardFilters
  ) => Promise<DashboardData>;
  plan: PlanInfo;
  availablePlans: AvailableTier[];
  defaultSubscriberName: string;
  defaultBusinessLegalName: string;
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

export function DashboardClient({
  initialData,
  fetchDashboardData,
  plan,
  availablePlans,
  defaultSubscriberName,
  defaultBusinessLegalName,
}: DashboardClientProps) {
  // Row A — the main dashboard filter. Also drives stat cards, monthly trend,
  // and the invoice table, since those aren't compared.
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
  const [data, setData] = useState<DashboardData>(initialData);
  const [loading, setLoading] = useState(false);

  // Row B — only populated while the compare view is active. Drives the
  // second pie chart. `null` filtersB means compare mode is off.
  const [filtersB, setFiltersB] = useState<DashboardFilters | null>(null);
  const [dataB, setDataB] = useState<DashboardData | null>(null);
  const [loadingB, setLoadingB] = useState(false);

  // Shared hover state for the compare view. When the user hovers a slice on
  // one pie chart, the sibling chart mirrors the tooltip on its own matching
  // slice (if the vendor exists on both sides). `null` means no vendor is
  // currently hovered.
  const [hoveredVendorId, setHoveredVendorId] = useState<string | null>(null);

  const compareMode = filtersB !== null;

  const handleFiltersChange = useCallback(
    async (newFilters: DashboardFilters) => {
      setFilters(newFilters);
      if (fetchDashboardData) {
        setLoading(true);
        try {
          const newData = await fetchDashboardData(newFilters);
          setData(newData);
        } catch (error) {
          console.error("Failed to fetch dashboard data:", error);
        } finally {
          setLoading(false);
        }
      }
    },
    [fetchDashboardData]
  );

  const handleFiltersBChange = useCallback(
    async (newFilters: DashboardFilters) => {
      setFiltersB(newFilters);
      if (fetchDashboardData) {
        setLoadingB(true);
        try {
          const newData = await fetchDashboardData(newFilters);
          setDataB(newData);
        } catch (error) {
          console.error("Failed to fetch dashboard data (B):", error);
        } finally {
          setLoadingB(false);
        }
      }
    },
    [fetchDashboardData]
  );

  const handleToggleCompare = useCallback(() => {
    if (filtersB !== null) {
      // Exit compare — drop row B entirely. Row A (the main dashboard) is
      // untouched.
      setFiltersB(null);
      setDataB(null);
      setLoadingB(false);
      return;
    }
    // Enter compare — seed row B with a duplicate of row A's filter so the
    // user starts from the exact same state and then adjusts one side. We
    // also reuse A's data as the initial B data, avoiding a redundant fetch.
    setFiltersB(filters);
    setDataB(data);
  }, [filtersB, filters, data]);

  // Stable vendor→color mapping shared across both pie charts in compare
  // mode, so the same vendor lines up visually on both sides.
  const compareColorMap = useMemo(() => {
    if (!compareMode || !dataB) return undefined;
    return buildVendorComparisonColorMap(
      data.vendorBreakdown,
      dataB.vendorBreakdown,
    );
  }, [compareMode, data.vendorBreakdown, dataB]);

  const refreshMainDashboardData = useCallback(async () => {
    if (!fetchDashboardData) return;
    setLoading(true);
    try {
      const newData = await fetchDashboardData(filters);
      setData(newData);
    } catch (error) {
      console.error("Failed to refresh dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, [fetchDashboardData, filters]);

  // Filter summaries shown as the pie chart sub-labels.
  const labelA = summarizeFilters(filters, data.vendors);
  const labelB =
    filtersB && dataB
      ? summarizeFilters(filtersB, dataB.vendors)
      : "";

  return (
    <div className="space-y-6">
      {/* Filter rows. In compare mode a second duplicate row appears directly
          underneath, each row driving its own pie chart below. */}
      <div className="space-y-2">
        <DashboardFiltersPanel
          vendors={data.vendors}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          compareMode={compareMode}
          onToggleCompare={fetchDashboardData ? handleToggleCompare : undefined}
          label={compareMode ? "A" : undefined}
        />
        {compareMode && filtersB && (
          <DashboardFiltersPanel
            vendors={(dataB ?? data).vendors}
            filters={filtersB}
            onFiltersChange={handleFiltersBChange}
            label="B"
          />
        )}
      </div>

      {/* Stat Cards — in compare mode each card splits into A/B halves so
          both rows can be read at once. */}
      <div className={loading || loadingB ? "animate-pulse" : ""}>
        <StatCards
          totalSpent={data.stats.totalSpent}
          invoiceCount={data.stats.invoiceCount}
          monthlyAverage={data.stats.monthlyAverage}
          burnRate={data.stats.burnRate}
          vendorCount={data.stats.vendorCount}
          llmTotalCostUsd={data.stats.llmTotalCostUsd}
          llmTotalTokens={data.stats.llmTotalTokens}
          currency={data.stats.currency}
          compare={
            compareMode && dataB
              ? {
                  totalSpent: dataB.stats.totalSpent,
                  invoiceCount: dataB.stats.invoiceCount,
                  monthlyAverage: dataB.stats.monthlyAverage,
                  burnRate: dataB.stats.burnRate,
                  vendorCount: dataB.stats.vendorCount,
                  llmTotalCostUsd: dataB.stats.llmTotalCostUsd,
                  llmTotalTokens: dataB.stats.llmTotalTokens,
                  currency: dataB.stats.currency,
                }
              : undefined
          }
        />
      </div>

      {/* Charts — in compare mode the monthly trend is hidden so two vendor
          donut charts can sit side by side without wrapping. */}
      {compareMode && dataB ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className={loading ? "animate-pulse" : ""}>
              <VendorDonutChart
                data={data.vendorBreakdown}
                currency={data.stats.currency}
                label={`A · ${labelA}`}
                colorMap={compareColorMap}
                onHoverVendor={setHoveredVendorId}
                externalHoveredVendorId={hoveredVendorId}
              />
            </div>
            <div className={loadingB ? "animate-pulse" : ""}>
              <VendorDonutChart
                data={dataB.vendorBreakdown}
                currency={dataB.stats.currency}
                label={`B · ${labelB}`}
                colorMap={compareColorMap}
                onHoverVendor={setHoveredVendorId}
                externalHoveredVendorId={hoveredVendorId}
              />
            </div>
          </div>
          <div className={loading || loadingB ? "animate-pulse" : ""}>
            <VendorComparisonChart
              dataA={data.vendorBreakdown}
              dataB={dataB.vendorBreakdown}
              currency={data.stats.currency}
            />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MonthlyTrendChart
            data={data.trendBuckets}
            currency={data.stats.currency}
            granularity={data.trendGranularity}
          />
          <VendorDonutChart
            data={data.vendorBreakdown}
            currency={data.stats.currency}
            onVendorSelect={(vendorIds) =>
              handleFiltersChange({ ...filters, vendorIds })
            }
          />
        </div>
      )}

      {/* Invoice Table */}
      <InvoiceTable
        invoices={data.invoices}
        showStatusActions
        onReExtractComplete={
          fetchDashboardData ? refreshMainDashboardData : undefined
        }
        onAfterBulkMutation={
          fetchDashboardData ? refreshMainDashboardData : undefined
        }
      />

      {/* Plan & usage lives at the foot of the page: it is a billing control,
          not an answer to "where is my money going", and it used to be the
          first thing on an expenses dashboard. */}
      <PlanUsageCard
        plan={plan}
        availablePlans={availablePlans}
        defaultSubscriberName={defaultSubscriberName}
        defaultBusinessLegalName={defaultBusinessLegalName}
      />
    </div>
  );
}