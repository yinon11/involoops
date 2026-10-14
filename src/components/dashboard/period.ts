/**
 * The period a dashboard is scoped to, and how to read it back out of a URL.
 *
 * Deliberately NOT in `period-filter.tsx`: that module is `"use client"`, and
 * a function exported from a client module cannot be called during a server
 * render — it is only ever a component or a prop. Server pages parse the
 * period with `readPeriod` here; the filter UI imports these types from the
 * same place, so there is one definition.
 */

export type PeriodRange = "allTime" | "last12Months" | "year";

export interface Period {
  range: PeriodRange;
  year: number | null;
  months: number[];
}

export const DEFAULT_PERIOD: Period = {
  range: "last12Months",
  year: null,
  months: [],
};

/** Parse the filter out of search params, rejecting anything malformed. */
export function readPeriod(params: {
  range?: string;
  year?: string;
  months?: string;
}): Period {
  const range: PeriodRange =
    params.range === "allTime" || params.range === "year"
      ? params.range
      : "last12Months";

  const parsedYear = Number(params.year);
  const year =
    range === "year" && Number.isInteger(parsedYear) && parsedYear > 1990
      ? parsedYear
      : null;

  // Months only mean something inside a year, and a year range with no valid
  // year would query an undefined window — both fall back to the default.
  if (range === "year" && year == null) return DEFAULT_PERIOD;

  const months =
    year == null
      ? []
      : (params.months ?? "")
          .split(",")
          .map((m) => Number(m))
          .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
          .sort((a, b) => a - b);

  return { range, year, months };
}
