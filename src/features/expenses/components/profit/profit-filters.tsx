"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DashboardTimeRange } from "@/features/expenses/components/dashboard/dashboard-filters";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface ProfitFilters {
  timeRange: DashboardTimeRange;
  year: number | null;
  months: number[];
  dateFrom: string | null;
  dateTo: string | null;
}

interface ProfitFiltersPanelProps {
  filters: ProfitFilters;
  onFiltersChange: (filters: ProfitFilters) => void;
}

const MONTH_KEYS: (keyof Dictionary["profit"]["monthsShort"])[] = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

const YEARS = [2023, 2024, 2025, 2026, 2027];

export function ProfitFiltersPanel({
  filters,
  onFiltersChange,
}: ProfitFiltersPanelProps) {
  const { dict } = useI18n();
  const t = dict.profit.filters;
  const monthsShort = dict.profit.monthsShort;
  const [lastClickedMonth, setLastClickedMonth] = useState<number | null>(null);

  function setTimeRange(timeRange: "allTime" | "last12Months") {
    // Quick time-range filters are mutually exclusive with a specific
    // year/month picks, so selecting one clears those.
    onFiltersChange({
      ...filters,
      timeRange,
      year: null,
      months: [],
    });
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
    onFiltersChange({ ...filters, timeRange: "year", year });
  }

  const isYearMode = filters.timeRange === "year";
  const currentYear = new Date().getFullYear();
  // Month buttons are clickable in "Last 12 months" and "year" modes. In
  // "Last 12 months" the first click promotes us into year mode on the
  // current year.
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
        year: currentYear,
        months: [month],
      });
      return;
    }

    const isSelected = filters.months.includes(month);
    let nextMonths: number[];

    if (event.shiftKey && lastClickedMonth !== null) {
      // Shift+click → select range between the last clicked month and this
      // one, merged with any existing selection.
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

  return (
    <Card className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 px-2.5 text-xs",
            filters.timeRange === "allTime" &&
              "bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white"
          )}
          onClick={() => setTimeRange("allTime")}
        >
          {t.allTimes}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 px-2.5 text-xs",
            filters.timeRange === "last12Months" &&
              "bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white"
          )}
          onClick={() => setTimeRange("last12Months")}
        >
          {t.last12Months}
        </Button>

        <div className="h-6 w-px bg-border" />

        {/* Year selector. When the "Last 12 months" quick filter is active the
            current year is shown as the placeholder — it has no effect on the
            results but signals which year the month buttons will jump into if
            clicked. Keeping Select's own value empty in that case means
            picking the current year from the dropdown still fires
            onValueChange (Radix swallows events for same-value selects). */}
        <Select
          value={isYearMode && filters.year !== null ? filters.year.toString() : ""}
          onValueChange={(val) => setYear(val ? parseInt(val, 10) : null)}
        >
          <SelectTrigger className="h-8 w-[120px]">
            <SelectValue
              placeholder={
                filters.timeRange === "last12Months"
                  ? currentYear.toString()
                  : t.selectYear
              }
            />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={y.toString()}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* All year button — only meaningful when a specific year is selected */}
        <Button
          variant="outline"
          size="sm"
          disabled={!isYearMode}
          title={
            isYearMode
              ? t.allYearTooltipEnabled
              : t.allYearTooltipDisabled
          }
          className={cn(
            "h-8 px-2.5 text-xs",
            isYearMode &&
              filters.months.length === 0 &&
              "bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white"
          )}
          onClick={setAllMonths}
        >
          {t.allYear}
        </Button>

        {/* Month buttons (multi-select with Ctrl/Shift). Enabled in both
            "year" and "Last 12 months" modes — in the latter a click jumps
            straight to that month in the current year (see handleMonthClick). */}
        <div
          className="flex flex-wrap gap-1"
          title={
            isYearMode
              ? t.monthTooltipYear
              : monthsInteractive
                ? t.monthTooltipQuick.replace("{year}", String(currentYear))
                : t.monthTooltipDisabled
          }
        >
          {MONTH_KEYS.map((key, idx) => {
            const monthNum = idx + 1;
            const selected = isYearMode && filters.months.includes(monthNum);
            return (
              <Button
                key={key}
                variant="outline"
                size="sm"
                disabled={!monthsInteractive}
                className={cn(
                  "h-8 px-2.5 text-xs",
                  selected &&
                    "bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white"
                )}
                onClick={(e) => handleMonthClick(monthNum, e)}
              >
                {monthsShort[key]}
              </Button>
            );
          })}
        </div>

        <div className="ms-auto flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <label className="font-medium">{t.from}</label>
            <input
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  dateFrom: e.target.value || null,
                })
              }
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <label className="font-medium">{t.to}</label>
            <input
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  dateTo: e.target.value || null,
                })
              }
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
