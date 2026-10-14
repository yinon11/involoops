"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";
import { useT } from "@/lib/i18n/client";
import {
  MAX_VENDOR_SLICES,
  LEGEND_PAGE_SIZE_DESKTOP,
  LEGEND_PAGE_SIZE_MOBILE,
} from "./config";

interface VendorDonutChartProps {
  data: { vendorId: string | null; vendorName: string; total: number }[];
  /** Dashboard display currency (aggregated totals). */
  currency: string;
  /**
   * Called when the user clicks a slice or legend row. Receives the vendor
   * IDs the slice represents: a single ID for a named vendor, or the full
   * list of vendors collapsed into the "Other" bucket.
   */
  onVendorSelect?: (vendorIds: string[]) => void;
  /**
   * Optional sub-label rendered under the card title. Used by the compare
   * view to show which filter a chart represents.
   */
  label?: string;
  /**
   * Override slice color by vendor ID. Used by the compare view so the same
   * vendor gets the same color in both pie charts (see
   * `buildVendorComparisonColorMap`). Slices whose vendor ID is missing from
   * the map fall back to the index-based palette.
   */
  colorMap?: ReadonlyMap<string, string>;
  /**
   * Called whenever the pointer enters or leaves a slice on this chart.
   * Receives the hovered vendor ID, or `null` when the pointer leaves the
   * pie (or enters the aggregated "Other" slice). Used by the compare view
   * to mirror the hover onto the sibling pie chart.
   */
  onHoverVendor?: (vendorId: string | null) => void;
  /**
   * Vendor ID currently hovered on the *sibling* chart in compare mode.
   * If the same vendor exists here, we draw a mirrored tooltip anchored at
   * that slice so the user sees the popup on both charts at once. Skipped
   * when it matches the locally-hovered slice (recharts is already drawing
   * its own tooltip there).
   */
  externalHoveredVendorId?: string | null;
  /** Card title. Defaults to "Spending by Vendor"; the income page passes
   * "Revenue by Client" so the same chart works for both sides. */
  titleText?: string;
  /** Hover tooltip for the total. Defaults to "Total spent in this view". */
  totalTooltip?: string;
}

type ChartSlice = {
  vendorId: string | null;
  vendorName: string;
  total: number;
  /** Present only on the aggregated "Other" slice. */
  otherVendorIds?: string[];
};

/**
 * Categorical slice palette — eight hues in a fixed, validated order.
 *
 * The previous palette led with two colours a deuteranope cannot separate
 * (#7c3aed beside #3b82f6, CVD deltaE 6.6) and then *generated* the remaining 40
 * slots by rotating hue with the golden angle. Generated hues cannot be
 * validated, and by the second rotation neighbouring vendors were
 * indistinguishable — which is the one thing this chart exists to prevent.
 *
 * Colour is assigned by vendor identity in rank order, never by slice
 * position within the current filter, so a vendor keeps its colour when the
 * filter changes and the reader who learned "AWS is blue" stays right.
 *
 * Validated as a set (light surface): worst adjacent CVD deltaE 9.1, worst
 * adjacent normal-vision deltaE 19.6. Three slots fall below 3:1 contrast on
 * white, so the legend beside the donut carries a visible name and amount for
 * every slice — identity is never colour alone.
 */
const COLORS = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

/** Colour for the aggregated tail. Neutral: "Other" is not an identity. */
const OTHER_COLOR = "#94a3b8";

function prepareData(data: VendorDonutChartProps["data"]): ChartSlice[] {
  const sorted = [...data].sort((a, b) => b.total - a.total);
  if (sorted.length <= MAX_VENDOR_SLICES) return sorted;

  // Past the palette there are no more distinguishable colours, and a donut
  // stops being readable long before 50 slices anyway. The tail collapses into
  // one neutral "Other" that is still clickable — selecting it filters the
  // dashboard down to exactly those vendors, so nothing becomes unreachable.
  const top = sorted.slice(0, MAX_VENDOR_SLICES - 1);
  const rest = sorted.slice(MAX_VENDOR_SLICES - 1);
  const otherTotal = rest.reduce((sum, d) => sum + d.total, 0);
  const otherVendorIds = rest
    .map((d) => d.vendorId)
    .filter((id): id is string => id !== null);

  return [
    ...top,
    {
      vendorId: null,
      vendorName: "Other",
      total: otherTotal,
      otherVendorIds,
    },
  ];
}

function selectSlice(
  slice: ChartSlice,
  onVendorSelect?: (vendorIds: string[]) => void,
) {
  if (!onVendorSelect) return;
  if (slice.vendorId) {
    onVendorSelect([slice.vendorId]);
  } else if (slice.otherVendorIds && slice.otherVendorIds.length > 0) {
    onVendorSelect(slice.otherVendorIds);
  }
}

/**
 * Build a stable vendor-id → color mapping shared across two datasets so the
 * compare view renders the same vendor with the same color on both pie
 * charts.
 *
 * Vendors are ranked by their combined total across both datasets and then
 * assigned colors from `COLORS` in rank order. A vendor that appears in only
 * one dataset still gets a consistent color, and the biggest overall vendors
 * land on the brand palette first.
 *
 * The "Other" bucket (null vendor id) is intentionally excluded — each chart
 * may collapse a different set of small vendors into "Other", so forcing a
 * shared color would be misleading.
 */
export function buildVendorComparisonColorMap(
  ...datasets: { vendorId: string | null; total: number }[][]
): Map<string, string> {
  const totals = new Map<string, number>();
  for (const dataset of datasets) {
    for (const row of dataset) {
      if (row.vendorId == null) continue;
      totals.set(row.vendorId, (totals.get(row.vendorId) ?? 0) + row.total);
    }
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const map = new Map<string, string>();
  ranked.forEach(([vendorId], i) => {
    if (i < COLORS.length) map.set(vendorId, COLORS[i]);
  });
  return map;
}

function resolveSliceColor(
  slice: ChartSlice,
  index: number,
  colorMap?: ReadonlyMap<string, string>,
): string {
  if (slice.vendorId && colorMap) {
    const override = colorMap.get(slice.vendorId);
    if (override) return override;
  }
  if (!slice.vendorId) return OTHER_COLOR;
  return COLORS[index] ?? OTHER_COLOR;
}

export function VendorDonutChart({
  data,
  currency,
  onVendorSelect,
  label,
  colorMap,
  onHoverVendor,
  externalHoveredVendorId,
  titleText,
  totalTooltip,
}: VendorDonutChartProps) {
  const t = useT().dashboard.charts;
  const resolvedTitle = titleText ?? t.spendingByVendor;
  const resolvedTotalTooltip = totalTooltip ?? t.totalSpentTooltip;
  const chartData = useMemo(() => prepareData(data), [data]);
  // Total spent across all vendors shown in this chart. Computed from the
  // raw input so the "Other" rollup doesn't affect the number.
  const total = useMemo(
    () => data.reduce((sum, d) => sum + d.total, 0),
    [data],
  );
  const [isMobile, setIsMobile] = useState(false);
  const [legendPage, setLegendPage] = useState(0);
  // Vendor ID currently hovered on this chart's own slices. Used to
  // suppress the mirrored tooltip when the sibling chart echoes back the
  // same vendor we're already showing via recharts' native tooltip.
  const [localHoveredVendorId, setLocalHoveredVendorId] = useState<
    string | null
  >(null);

  // Reset legend pagination whenever the underlying data changes so the
  // user always starts at the top of the list after a filter change.
  // Uses the idiomatic render-phase reset pattern — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevChartData, setPrevChartData] = useState(chartData);
  if (prevChartData !== chartData) {
    setPrevChartData(chartData);
    setLegendPage(0);
  }

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const pageSize = isMobile ? LEGEND_PAGE_SIZE_MOBILE : LEGEND_PAGE_SIZE_DESKTOP;
  const pageCount = Math.max(1, Math.ceil(chartData.length / pageSize));
  const safePage = Math.min(legendPage, pageCount - 1);
  const pageStart = safePage * pageSize;
  const pageItems = chartData.slice(pageStart, pageStart + pageSize);
  const showPager = chartData.length > pageSize;

  // Track the chart container's rendered size so we can anchor the mirrored
  // tooltip over the correct slice when the sibling chart in compare mode
  // hovers a vendor that also exists here.
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setChartSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Proportional mid-angle (in degrees, measured counter-clockwise from
  // 3 o'clock — recharts' default pie orientation) for every slice. We
  // ignore the small adjustments recharts applies for `paddingAngle` and
  // `minAngle`; they shift a slice's centroid by at most ~1°, which is
  // well inside the tolerance for anchoring a tooltip over a wedge.
  const sliceMidAngles = useMemo(() => {
    const sum = chartData.reduce((s, d) => s + d.total, 0);
    if (sum === 0) return [] as number[];
    let start = 0;
    return chartData.map((slice) => {
      const sweep = (slice.total / sum) * 360;
      const mid = start + sweep / 2;
      start += sweep;
      return mid;
    });
  }, [chartData]);

  const innerRadius = isMobile ? 45 : 60;
  const outerRadius = isMobile ? 75 : 100;

  // Position + content of the tooltip drawn when the sibling chart is
  // hovering a vendor that also exists here. `null` means "don't draw it".
  const mirroredTooltip = useMemo(() => {
    if (!externalHoveredVendorId) return null;
    // The sibling is echoing our own hover back at us — recharts is
    // already showing its native tooltip over the same slice, so skip.
    if (externalHoveredVendorId === localHoveredVendorId) return null;
    if (chartSize.width === 0 || chartSize.height === 0) return null;
    const idx = chartData.findIndex(
      (s) => s.vendorId === externalHoveredVendorId,
    );
    if (idx < 0) return null;
    const midAngle = sliceMidAngles[idx];
    if (midAngle === undefined) return null;
    const slice = chartData[idx];
    const cx = chartSize.width / 2;
    const cy = chartSize.height / 2;
    const r = (innerRadius + outerRadius) / 2;
    const rad = (midAngle * Math.PI) / 180;
    return {
      // SVG y axis grows downward, so subtract sin() to put positive
      // angles above the center (matching recharts' visual rendering).
      x: cx + r * Math.cos(rad),
      y: cy - r * Math.sin(rad),
      vendorName: slice.vendorName,
      total: slice.total,
      color: resolveSliceColor(slice, idx, colorMap),
    };
  }, [
    externalHoveredVendorId,
    localHoveredVendorId,
    chartSize,
    chartData,
    sliceMidAngles,
    innerRadius,
    outerRadius,
    colorMap,
  ]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="text-lg font-semibold">
            {resolvedTitle}
          </CardTitle>
          <span
            className="shrink-0 text-base font-semibold tabular-nums text-foreground"
            title={resolvedTotalTooltip}
          >
            {formatCurrency(total, currency)}
          </span>
        </div>
        {label && (
          <p
            className="mt-1 truncate text-xs font-medium text-muted-foreground"
            title={label}
          >
            {label}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {/* Ring above, legend below. Side by side the legend got roughly a
            quarter of the page and truncated "Amazon Web Services" to
            "Amazon Web…" — and that legend is the contrast relief for the
            palette slots that sit under 3:1 on white, so it has to be
            readable. Stacked it also matches the income overview's donut. */}
        <div className="flex w-full flex-col items-center gap-3">
          <div
            ref={chartContainerRef}
            className="relative h-[220px] w-[220px] shrink-0"
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={innerRadius}
                  outerRadius={outerRadius}
                  paddingAngle={2}
                  // Guarantee every vendor gets a visible wedge even when
                  // its share is a tiny fraction of the total. Without
                  // this, vendors worth a few dollars on a five-figure
                  // chart render as sub-degree slivers.
                  minAngle={2}
                  dataKey="total"
                  nameKey="vendorName"
                  className="cursor-pointer outline-none"
                  onClick={(_, index) => {
                    const slice = chartData[index];
                    if (slice) selectSlice(slice, onVendorSelect);
                  }}
                  onMouseEnter={(_, index) => {
                    const slice = chartData[index];
                    if (!slice) return;
                    setLocalHoveredVendorId(slice.vendorId);
                    onHoverVendor?.(slice.vendorId);
                  }}
                  onMouseLeave={() => {
                    setLocalHoveredVendorId(null);
                    onHoverVendor?.(null);
                  }}
                >
                  {chartData.map((slice, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={resolveSliceColor(slice, index, colorMap)}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [
                    formatCurrency(Number(value), currency),
                    name,
                  ]}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid #e5e7eb",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {mirroredTooltip && (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-[0_2px_8px_rgba(0,0,0,0.1)] dark:border-gray-700 dark:bg-gray-900"
                style={{
                  left: `${mirroredTooltip.x}px`,
                  top: `${mirroredTooltip.y}px`,
                }}
              >
                <div className="mb-0.5 font-medium text-gray-900 dark:text-gray-100">
                  {mirroredTooltip.vendorName}
                </div>
                <div className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: mirroredTooltip.color }}
                  />
                  <span>
                    {mirroredTooltip.vendorName} :{" "}
                    <span className="tabular-nums">
                      {formatCurrency(mirroredTooltip.total, currency)}
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Custom paginated legend */}
          <div className="flex w-full min-w-0 flex-col justify-center">
            <ul className="space-y-1 text-xs sm:text-sm">
              {pageItems.map((slice, i) => {
                const absoluteIndex = pageStart + i;
                const color = resolveSliceColor(slice, absoluteIndex, colorMap);
                const clickable =
                  !!onVendorSelect &&
                  (!!slice.vendorId ||
                    (slice.otherVendorIds?.length ?? 0) > 0);
                return (
                  <li key={`${slice.vendorId ?? "other"}-${absoluteIndex}`}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => selectSlice(slice, onVendorSelect)}
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-start hover:bg-gray-100 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-gray-800"
                      title={slice.vendorName}
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {slice.vendorName}
                      </span>
                      {/* Compact: the cents on a five-figure total bought
                          nothing and cost the vendor name four characters. */}
                      <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-400">
                        {formatCurrencyCompact(slice.total, currency)}
                      </span>
                      <span className="w-9 shrink-0 text-end tabular-nums text-[11px] text-gray-400">
                        {total > 0 ? Math.round((slice.total / total) * 100) : 0}%
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {showPager && (
              <div className="mt-2 flex items-center justify-end gap-2 text-xs text-gray-600 dark:text-gray-400">
                <span className="tabular-nums">
                  {safePage + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setLegendPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="rounded border border-gray-200 p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                  aria-label={t.previousVendors}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setLegendPage((p) => Math.min(pageCount - 1, p + 1))
                  }
                  disabled={safePage >= pageCount - 1}
                  className="rounded border border-gray-200 p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                  aria-label={t.nextVendors}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
