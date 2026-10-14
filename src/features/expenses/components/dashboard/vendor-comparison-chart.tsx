"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, getCurrencySymbol } from "@/lib/currency";
import {
  VENDOR_COMPARE_TOP_COMMON,
  VENDOR_COMPARE_TOP_UNIQUE_PER_SIDE,
} from "./config";

/**
 * Compact currency format for Y-axis ticks ("$1.2k", "$5M") so wide value
 * ranges stay readable. Falls back to the currency symbol + compact
 * number when the locale lookup fails.
 */
function formatCurrencyCompact(amount: number, currency: string): string {
  const upperCurrency = currency.toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: upperCurrency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return `${getCurrencySymbol(upperCurrency)}${amount.toFixed(0)}`;
  }
}

// Kept in sync with the A/B badges on the filter rows above.
const COLOR_A = "#7c3aed"; // purple
const COLOR_B = "#3b82f6"; // blue

type VendorRow = { vendorId: string | null; vendorName: string; total: number };

type Zone = "common" | "aOnly" | "bOnly";

type ChartRow = {
  /**
   * Stable per-row key used as the XAxis category value. Vendor ID is a
   * safer choice than the display name because two different vendors can
   * legitimately share a name; colliding on the axis would merge their
   * bars. The display name is rendered via the XAxis `tickFormatter`.
   */
  vendorId: string;
  vendorName: string;
  a?: number;
  b?: number;
  zone: Zone;
  /**
   * Marker for the blank spacer columns inserted between zones to give
   * the Common / A-only / B-only groups a visible gap on the X axis.
   * Spacer rows carry no A/B values, no tick label, and no tooltip.
   */
  isSpacer?: boolean;
};

interface VendorComparisonChartProps {
  dataA: VendorRow[];
  dataB: VendorRow[];
  currency: string;
  /** Override number of common vendors shown (defaults to the config). */
  topCommon?: number;
  /** Override number of unique vendors per side (defaults to the config). */
  topUniquePerSide?: number;
}

/**
 * Split the two datasets into three sorted buckets for the comparison
 * chart:
 *
 * 1. Common vendors (present in both A and B), ranked by |B − A| desc —
 *    "what moved the most".
 * 2. A-only vendors, ranked by their own total desc.
 * 3. B-only vendors, ranked by their own total desc.
 *
 * Vendors without a stable `vendorId` (the "Other" bucket, unlinked
 * invoices) are intentionally dropped — joining them across sides would
 * be misleading since each pie collapses a different set of vendors.
 */
function buildRows(
  dataA: VendorRow[],
  dataB: VendorRow[],
  topCommon: number,
  topUniquePerSide: number,
): ChartRow[] {
  const aById = new Map<string, VendorRow>();
  for (const row of dataA) {
    if (row.vendorId) aById.set(row.vendorId, row);
  }
  const bById = new Map<string, VendorRow>();
  for (const row of dataB) {
    if (row.vendorId) bById.set(row.vendorId, row);
  }

  const common: ChartRow[] = [];
  for (const [vendorId, aRow] of aById) {
    const bRow = bById.get(vendorId);
    if (!bRow) continue;
    common.push({
      vendorId,
      vendorName: aRow.vendorName,
      a: aRow.total,
      b: bRow.total,
      zone: "common",
    });
  }
  common.sort(
    (x, y) => Math.abs((y.b ?? 0) - (y.a ?? 0)) - Math.abs((x.b ?? 0) - (x.a ?? 0)),
  );

  const aOnly: ChartRow[] = [];
  for (const [vendorId, aRow] of aById) {
    if (bById.has(vendorId)) continue;
    aOnly.push({
      vendorId,
      vendorName: aRow.vendorName,
      a: aRow.total,
      zone: "aOnly",
    });
  }
  aOnly.sort((x, y) => (y.a ?? 0) - (x.a ?? 0));

  const bOnly: ChartRow[] = [];
  for (const [vendorId, bRow] of bById) {
    if (aById.has(vendorId)) continue;
    bOnly.push({
      vendorId,
      vendorName: bRow.vendorName,
      b: bRow.total,
      zone: "bOnly",
    });
  }
  bOnly.sort((x, y) => (y.b ?? 0) - (x.b ?? 0));

  // Interleave blank spacer rows between non-empty zones. Spacers take
  // up their own X-axis slot but have no bar data, so the Common / A-only
  // / B-only groups read as three visually detached charts instead of
  // one continuous strip.
  const zones = [
    common.slice(0, topCommon),
    aOnly.slice(0, topUniquePerSide),
    bOnly.slice(0, topUniquePerSide),
  ];
  const rows: ChartRow[] = [];
  for (const zoneRows of zones) {
    if (zoneRows.length === 0) continue;
    if (rows.length > 0) {
      rows.push({
        vendorId: `__spacer__${rows.length}`,
        vendorName: "",
        zone: zoneRows[0].zone,
        isSpacer: true,
      });
    }
    rows.push(...zoneRows);
  }
  return rows;
}

/**
 * Shade the background of each zone so the three groups (common / A-only
 * / B-only) are visually distinct. Returns an array of ReferenceArea
 * descriptors keyed by the first and last vendor name in each zone —
 * ReferenceArea uses category values on the X axis.
 */
function computeZoneBands(rows: ChartRow[]): {
  zone: Zone;
  x1: string;
  x2: string;
  label: string;
}[] {
  const bands: { zone: Zone; x1: string; x2: string; label: string }[] = [];
  const zoneLabels: Record<Zone, string> = {
    common: "Common",
    aOnly: "A only",
    bOnly: "B only",
  };

  let i = 0;
  while (i < rows.length) {
    if (rows[i].isSpacer) {
      i++;
      continue;
    }
    const zone = rows[i].zone;
    let j = i;
    while (j < rows.length && !rows[j].isSpacer && rows[j].zone === zone) j++;
    bands.push({
      zone,
      x1: rows[i].vendorId,
      x2: rows[j - 1].vendorId,
      label: zoneLabels[zone],
    });
    i = j;
  }
  return bands;
}

type TooltipPayloadItem = {
  dataKey?: string | number;
  value?: number;
  payload?: ChartRow;
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  currency: string;
}

function CustomTooltip({ active, payload, currency }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row || row.isSpacer) return null;

  const a = row.a;
  const b = row.b;
  const hasBoth = a !== undefined && b !== undefined;
  const delta = hasBoth ? (b as number) - (a as number) : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-[0_2px_8px_rgba(0,0,0,0.1)] dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-1 font-medium text-gray-900 dark:text-gray-100">
        {row.vendorName}
      </div>
      {a !== undefined && (
        <div className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: COLOR_A }}
          />
          <span>A :</span>
          <span className="tabular-nums">{formatCurrency(a, currency)}</span>
        </div>
      )}
      {b !== undefined && (
        <div className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: COLOR_B }}
          />
          <span>B :</span>
          <span className="tabular-nums">{formatCurrency(b, currency)}</span>
        </div>
      )}
      {delta !== null && (
        <div className="mt-1 border-t border-gray-200 pt-1 text-gray-700 dark:border-gray-700 dark:text-gray-300">
          <span>Δ : </span>
          <span
            className={
              delta > 0
                ? "tabular-nums text-emerald-600 dark:text-emerald-400"
                : delta < 0
                  ? "tabular-nums text-red-600 dark:text-red-400"
                  : "tabular-nums"
            }
          >
            {delta > 0 ? "+" : ""}
            {formatCurrency(delta, currency)}
          </span>
        </div>
      )}
    </div>
  );
}

export function VendorComparisonChart({
  dataA,
  dataB,
  currency,
  topCommon = VENDOR_COMPARE_TOP_COMMON,
  topUniquePerSide = VENDOR_COMPARE_TOP_UNIQUE_PER_SIDE,
}: VendorComparisonChartProps) {
  const rows = useMemo(
    () => buildRows(dataA, dataB, topCommon, topUniquePerSide),
    [dataA, dataB, topCommon, topUniquePerSide],
  );
  const zoneBands = useMemo(() => computeZoneBands(rows), [rows]);
  // vendor-id → display name for the X-axis tick formatter.
  const idToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.vendorId, r.vendorName);
    return m;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">
            Vendor comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No vendors to compare in the current filters.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="text-lg font-semibold">
            Vendor comparison
          </CardTitle>
          <span className="shrink-0 text-xs text-muted-foreground">
            top {topCommon} by |Δ|, plus top {topUniquePerSide} unique per side
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 8, right: 16, bottom: 56, left: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#e5e7eb"
              />
              {zoneBands.map((band, i) => {
                // Tint each zone so the three groups are visually
                // distinct: neutral grey for Common, a faint A/B color
                // wash for the unique zones. Labels are drawn in the
                // zone color too so "A only" / "B only" read
                // unambiguously.
                const fill =
                  band.zone === "common"
                    ? "#f3f4f6"
                    : band.zone === "aOnly"
                      ? COLOR_A
                      : COLOR_B;
                const labelFill =
                  band.zone === "common"
                    ? "#6b7280"
                    : band.zone === "aOnly"
                      ? COLOR_A
                      : COLOR_B;
                return (
                  <ReferenceArea
                    key={`${band.zone}-${i}`}
                    x1={band.x1}
                    x2={band.x2}
                    fill={fill}
                    fillOpacity={band.zone === "common" ? 0.7 : 0.1}
                    stroke={band.zone === "common" ? "none" : fill}
                    strokeOpacity={0.3}
                    ifOverflow="extendDomain"
                    label={{
                      value: band.label,
                      position: "insideTop",
                      fill: labelFill,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  />
                );
              })}
              <XAxis
                dataKey="vendorId"
                interval={0}
                angle={-35}
                textAnchor="end"
                height={56}
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickFormatter={(id: string) => {
                  // Spacer slots have no display name — render an empty
                  // label so the gap between zones stays clean.
                  if (id.startsWith("__spacer__")) return "";
                  const name = idToName.get(id) ?? id;
                  // Keep the axis readable when vendor names are long.
                  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
                }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickFormatter={(v: number) =>
                  formatCurrencyCompact(v, currency)
                }
                width={64}
              />
              <Tooltip
                cursor={{ fill: "#8b5cf620" }}
                content={<CustomTooltip currency={currency} />}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value) => (value === "a" ? "A" : "B")}
              />
              <Bar dataKey="a" fill={COLOR_A} radius={[2, 2, 0, 0]} />
              <Bar dataKey="b" fill={COLOR_B} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
