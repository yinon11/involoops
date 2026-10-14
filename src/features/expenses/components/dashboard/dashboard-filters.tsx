"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns2, X } from "lucide-react";
import {
  FilterBar,
  FilterChip,
  FilterGroup,
  MultiSelectFilter,
  filterInputClassName,
} from "@/components/dashboard/filter-bar";
import { useT } from "@/lib/i18n/client";

export type DashboardTimeRange = "allTime" | "last12Months" | "year";

export interface DashboardFilters {
  vendorIds: string[];
  timeRange: DashboardTimeRange;
  year: number | null;
  months: number[];
  dateFrom: string | null;
  dateTo: string | null;
  showWithoutVat: boolean;
}

interface DashboardFiltersProps {
  vendors: { id: string; name: string }[];
  filters: DashboardFilters;
  onFiltersChange: (filters: DashboardFilters) => void;
  /**
   * When true, the panel is one row of a side-by-side comparison. The compare
   * toggle label flips to "Exit compare" and gets a highlighted style so the
   * user can see the dashboard is in compare mode.
   */
  compareMode?: boolean;
  /**
   * Toggle compare mode. When undefined the Compare button is hidden, which
   * lets callers that don't support comparing (e.g. the second row of the
   * compare view, embedded previews) reuse the panel without an inert button.
   */
  onToggleCompare?: () => void;
  /**
   * Optional short label ("A" / "B") rendered as a badge at the start of the
   * filter row. Used by the compare view to identify which row drives which
   * pie chart.
   */
  label?: string;
}

const YEARS = [2023, 2024, 2025, 2026, 2027];

export function DashboardFiltersPanel({
  vendors,
  filters,
  onFiltersChange,
  compareMode = false,
  onToggleCompare,
  label,
}: DashboardFiltersProps) {
  const t = useT().dashboard.filters;
  const MONTHS = [
    t.months.jan, t.months.feb, t.months.mar, t.months.apr, t.months.may, t.months.jun,
    t.months.jul, t.months.aug, t.months.sep, t.months.oct, t.months.nov, t.months.dec,
  ];
  const [lastClickedMonth, setLastClickedMonth] = useState<number | null>(null);

  function toggleVendor(vendorId: string) {
    const next = filters.vendorIds.includes(vendorId)
      ? filters.vendorIds.filter((id) => id !== vendorId)
      : [...filters.vendorIds, vendorId];
    onFiltersChange({ ...filters, vendorIds: next });
  }

  function setYear(year: number | null) {
    if (year === null) {
      // Clearing the year drops us back to the default "Last 12 months"
      // quick filter, since months only make sense within a year context.
      onFiltersChange({
        ...filters,
        timeRange: "last12Months",
        year: null,
        months: [],
      });
      return;
    }
    onFiltersChange({
      ...filters,
      timeRange: "year",
      year,
    });
  }

  function setTimeRange(timeRange: "allTime" | "last12Months") {
    // "All times" and "Last 12 months" are mutually exclusive with a specific
    // year, so picking one clears the year + month selection.
    onFiltersChange({
      ...filters,
      timeRange,
      year: null,
      months: [],
    });
  }

  const isYearMode = filters.timeRange === "year";
  const currentYear = new Date().getFullYear();
  // Month buttons are clickable in "Last 12 months" and "year" modes. In
  // "Last 12 months" the first click promotes us into year mode on the
  // current year; see handleMonthClick.
  const monthsInteractive = filters.timeRange !== "allTime";

  function handleMonthClick(month: number, event: React.MouseEvent) {
    // When the active filter is "Last 12 months", clicking a month promotes
    // us straight into year mode on the current year with that month as the
    // only selection — a one-click shortcut from the default view to a
    // specific month, instead of "pick year, then pick month".
    if (!isYearMode) {
      setLastClickedMonth(month);
      onFiltersChange({
        ...filters,
        timeRange: "year",
        year: new Date().getFullYear(),
        months: [month],
      });
      return;
    }

    const isSelected = filters.months.includes(month);
    let nextMonths: number[];

    if (event.shiftKey && lastClickedMonth !== null) {
      // Shift+click → select range between the last clicked month and this one,
      // merged with any existing selection.
      const from = Math.min(lastClickedMonth, month);
      const to = Math.max(lastClickedMonth, month);
      const range: number[] = [];
      for (let m = from; m <= to; m++) range.push(m);
      nextMonths = Array.from(new Set([...filters.months, ...range])).sort(
        (a, b) => a - b
      );
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+click → toggle this month in/out of the current selection.
      nextMonths = isSelected
        ? filters.months.filter((m) => m !== month)
        : [...filters.months, month].sort((a, b) => a - b);
    } else {
      // Plain click → select only this month (or clear if it was the only one).
      nextMonths =
        isSelected && filters.months.length === 1 ? [] : [month];
    }

    setLastClickedMonth(month);
    onFiltersChange({ ...filters, months: nextMonths });
  }

  function setAllMonths() {
    onFiltersChange({ ...filters, months: [] });
  }

  // Any filter active — drives the reset control. The default range is
  // "last12Months", so anything else counts as active.
  const hasActiveFilters =
    filters.vendorIds.length > 0 ||
    filters.timeRange !== "last12Months" ||
    filters.year !== null ||
    filters.months.length > 0 ||
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.showWithoutVat;

  // What the vendor button says. One vendor reads better as its name than as
  // "1 selected"; past one, a count is all that fits.
  const vendorButtonLabel =
    filters.vendorIds.length === 0
      ? t.allVendors
      : filters.vendorIds.length === 1
        ? (vendors.find((v) => v.id === filters.vendorIds[0])?.name ?? t.oneVendor)
        : t.onePlusVendors.replace(
            "{count}",
            filters.vendorIds.length.toString(),
          );

  function resetFilters() {
    onFiltersChange({
      vendorIds: [],
      timeRange: "last12Months",
      year: null,
      months: [],
      dateFrom: null,
      dateTo: null,
      showWithoutVat: false,
    });
  }

  return (
    <FilterBar
      trailing={
        <>
          {onToggleCompare && (
            <FilterChip
              selected={compareMode}
              onClick={onToggleCompare}
              title={compareMode ? t.compareTooltipExit : t.compareTooltipEnter}
            >
              <Columns2 className="h-3.5 w-3.5" />
              {compareMode ? t.exitCompare : t.compare}
            </FilterChip>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              aria-label={t.resetAllAria}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              <X className="h-3.5 w-3.5" />
              {t.reset}
            </button>
          )}
        </>
      }
    >
      {/* A/B badge — only in the compare view, so each row is visibly tied to
          the pie chart it drives. */}
      {label && (
        <div className="flex items-end pb-0.5">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-xs font-bold text-white"
          >
            {label}
          </span>
        </div>
      )}

      <FilterGroup label={t.groupWhen}>
        <FilterChip
          selected={filters.timeRange === "allTime"}
          onClick={() => setTimeRange("allTime")}
        >
          {t.allTimes}
        </FilterChip>
        <FilterChip
          selected={filters.timeRange === "last12Months"}
          onClick={() => setTimeRange("last12Months")}
        >
          {t.last12Months}
        </FilterChip>
        <select
          value={isYearMode && filters.year !== null ? filters.year.toString() : ""}
          onChange={(e) => setYear(e.target.value ? parseInt(e.target.value, 10) : null)}
          aria-label={t.selectYear}
          className={filterInputClassName}
        >
          {/* Never the current year: a placeholder reading "2026" beside a
              real "2026" option makes the choice a coin flip. */}
          <option value="">{t.selectYear}</option>
          {YEARS.map((y) => (
            <option key={y} value={y.toString()}>
              {y}
            </option>
          ))}
        </select>
      </FilterGroup>

      <FilterGroup
        label={t.groupMonths}
        hint={
          isYearMode
            ? t.monthTooltipYear
            : monthsInteractive
              ? t.monthTooltipQuick.replace("{year}", currentYear.toString())
              : t.monthTooltipDisabled
        }
      >
        <FilterChip
          disabled={!isYearMode}
          selected={isYearMode && filters.months.length === 0}
          onClick={setAllMonths}
          title={isYearMode ? t.allYearTooltipEnabled : t.allYearTooltipDisabled}
        >
          {t.allYear}
        </FilterChip>
        {MONTHS.map((monthLabel, idx) => {
          const monthNum = idx + 1;
          return (
            <FilterChip
              key={monthLabel}
              disabled={!monthsInteractive}
              selected={isYearMode && filters.months.includes(monthNum)}
              onClick={(e) => handleMonthClick(monthNum, e)}
              className="px-2"
            >
              {monthLabel}
            </FilterChip>
          );
        })}
      </FilterGroup>

      {/* Used to live behind a 32px icon button. */}
      <FilterGroup label={t.groupWho}>
        <MultiSelectFilter
          buttonLabel={vendorButtonLabel}
          selectedCount={filters.vendorIds.length}
          options={vendors}
          selectedIds={filters.vendorIds}
          onToggle={toggleVendor}
          onClear={() => onFiltersChange({ ...filters, vendorIds: [] })}
          searchPlaceholder={t.searchVendors}
          emptyLabel={t.noVendorsFound}
          clearLabel={t.clearVendors}
        />
      </FilterGroup>

      <FilterGroup label={t.groupExactDates}>
        <input
          type="date"
          value={filters.dateFrom ?? ""}
          aria-label={t.startDate}
          onChange={(e) =>
            onFiltersChange({ ...filters, dateFrom: e.target.value || null })
          }
          className={filterInputClassName}
        />
        <span className="text-xs text-slate-400">{t.dateTo}</span>
        <input
          type="date"
          value={filters.dateTo ?? ""}
          aria-label={t.endDate}
          onChange={(e) =>
            onFiltersChange({ ...filters, dateTo: e.target.value || null })
          }
          className={filterInputClassName}
        />
      </FilterGroup>

      <FilterGroup label={t.groupInclude}>
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">
          <Checkbox
            checked={filters.showWithoutVat}
            onCheckedChange={(checked) =>
              onFiltersChange({ ...filters, showWithoutVat: checked === true })
            }
          />
          {t.showWithoutVat}
        </label>
      </FilterGroup>
    </FilterBar>
  );
}
