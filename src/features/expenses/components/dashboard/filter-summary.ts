import type { DashboardFilters } from "./dashboard-filters";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Render a DashboardFilters value as a short human label for use as a chart
 * subtitle (e.g. in the compare view). Segments are joined with " · " and
 * empty segments are dropped so the label stays compact.
 */
export function summarizeFilters(
  filters: DashboardFilters,
  vendors: { id: string; name: string }[],
): string {
  const parts: string[] = [];

  // Time range
  if (filters.timeRange === "allTime") {
    parts.push("All time");
  } else if (filters.timeRange === "year" && filters.year !== null) {
    if (filters.months.length === 0 || filters.months.length === 12) {
      parts.push(String(filters.year));
    } else {
      const months = filters.months
        .slice()
        .sort((a, b) => a - b)
        .map((m) => MONTH_LABELS[m - 1])
        .join(", ");
      parts.push(`${months} ${filters.year}`);
    }
  } else {
    parts.push("Last 12 months");
  }

  // Custom date range (independent of the time-range quick filter)
  if (filters.dateFrom || filters.dateTo) {
    parts.push(`${filters.dateFrom ?? "…"} → ${filters.dateTo ?? "…"}`);
  }

  // Vendors
  if (filters.vendorIds.length === 1) {
    const v = vendors.find((v) => v.id === filters.vendorIds[0]);
    parts.push(v?.name ?? "1 vendor");
  } else if (filters.vendorIds.length > 1) {
    parts.push(`${filters.vendorIds.length} vendors`);
  }

  if (filters.showWithoutVat) {
    parts.push("ex. VAT");
  }

  return parts.join(" · ") || "All invoices";
}
