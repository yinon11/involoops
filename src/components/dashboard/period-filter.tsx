"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  FilterBar,
  FilterChip,
  FilterGroup,
  filterInputClassName,
} from "./filter-bar";
import type { Period } from "./period";

/**
 * Period filter for a server-rendered overview.
 *
 * State lives in the URL rather than in React, which keeps the page a server
 * component (the queries stay on the server, no data crosses the boundary)
 * and makes a filtered view a link someone can bookmark or send to their
 * accountant. `scroll: false` keeps the page from jumping to the top on every
 * chip click.
 */
export function PeriodFilter({
  period,
  years,
  labels,
}: {
  period: Period;
  years: number[];
  labels: {
    when: string;
    months: string;
    allTimes: string;
    last12Months: string;
    selectYear: string;
    allYear: string;
    monthNames: string[];
    monthHint: string;
    reset: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function apply(next: Period) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.range === "last12Months") params.delete("range");
    else params.set("range", next.range);
    if (next.year == null) params.delete("year");
    else params.set("year", String(next.year));
    if (next.months.length === 0) params.delete("months");
    else params.set("months", next.months.join(","));
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  }

  const isYearMode = period.range === "year";
  const currentYear = new Date().getFullYear();
  const isDefault =
    period.range === "last12Months" &&
    period.year == null &&
    period.months.length === 0;

  function toggleMonth(month: number, event: React.MouseEvent) {
    // Outside year mode a month click is a shortcut: jump to that month of the
    // current year rather than making people pick the year first.
    if (!isYearMode) {
      apply({ range: "year", year: currentYear, months: [month] });
      return;
    }
    const selected = period.months.includes(month);
    const months =
      event.ctrlKey || event.metaKey
        ? selected
          ? period.months.filter((m) => m !== month)
          : [...period.months, month].sort((a, b) => a - b)
        : selected && period.months.length === 1
          ? []
          : [month];
    apply({ ...period, months });
  }

  return (
    <div className={isPending ? "opacity-60 transition-opacity" : undefined}>
      <FilterBar
        trailing={
          isDefault ? null : (
            <button
              type="button"
              onClick={() =>
                apply({ range: "last12Months", year: null, months: [] })
              }
              className="inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              {labels.reset}
            </button>
          )
        }
      >
        <FilterGroup label={labels.when}>
          <FilterChip
            selected={period.range === "allTime"}
            onClick={() => apply({ range: "allTime", year: null, months: [] })}
          >
            {labels.allTimes}
          </FilterChip>
          <FilterChip
            selected={period.range === "last12Months"}
            onClick={() =>
              apply({ range: "last12Months", year: null, months: [] })
            }
          >
            {labels.last12Months}
          </FilterChip>
          <select
            value={isYearMode && period.year != null ? String(period.year) : ""}
            aria-label={labels.selectYear}
            onChange={(e) =>
              apply(
                e.target.value
                  ? { range: "year", year: Number(e.target.value), months: [] }
                  : { range: "last12Months", year: null, months: [] },
              )
            }
            className={filterInputClassName}
          >
            <option value="">{labels.selectYear}</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </FilterGroup>

        <FilterGroup label={labels.months} hint={labels.monthHint}>
          <FilterChip
            disabled={!isYearMode}
            selected={isYearMode && period.months.length === 0}
            onClick={() => apply({ ...period, months: [] })}
          >
            {labels.allYear}
          </FilterChip>
          {labels.monthNames.map((name, idx) => (
            <FilterChip
              key={name}
              selected={isYearMode && period.months.includes(idx + 1)}
              onClick={(e) => toggleMonth(idx + 1, e)}
              className="px-2"
            >
              {name}
            </FilterChip>
          ))}
        </FilterGroup>
      </FilterBar>
    </div>
  );
}
