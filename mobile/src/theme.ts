import { useColorScheme } from "react-native";

/** InvoLoops violet, the same accent as the website (`--primary`). */
export const brand = {
  violet: "#7C3AED",
  violetPressed: "#6D28D9",
  violetDeep: "#4C1D95",
  onViolet: "#F8FAFC",
} as const;

const light = {
  background: "#FFFFFF",
  label: "#0F172A",
  secondaryLabel: "#64748B",
  separator: "#E2E8F0",
  field: "#F1F5F9",
  pressed: "#F8FAFC",
  destructive: "#DC2626",
  /** Money coming in (charts, deltas). */
  income: "#059669",
  incomeSoft: "#D1FAE5",
  /** Money going out (charts, deltas). */
  expense: "#E11D48",
  expenseSoft: "#FFE4E6",
  warning: "#B45309",
  warningSoft: "#FEF3C7",
  info: "#1D4ED8",
  infoSoft: "#DBEAFE",
  /** Categorical series for donut/rank charts, brand-first. */
  chart: ["#7C3AED", "#0891B2", "#F59E0B", "#10B981", "#3B82F6", "#EC4899"],
  chartMuted: "#CBD5E1",
  gridLine: "#E2E8F0",
};

const dark: Palette = {
  background: "#0B0F19",
  label: "#F8FAFC",
  secondaryLabel: "#94A3B8",
  separator: "#1E293B",
  field: "#151C2C",
  pressed: "#111827",
  destructive: "#F87171",
  income: "#34D399",
  incomeSoft: "#064E3B",
  expense: "#FB7185",
  expenseSoft: "#4C0519",
  warning: "#FBBF24",
  warningSoft: "#451A03",
  info: "#60A5FA",
  infoSoft: "#172554",
  chart: ["#A78BFA", "#22D3EE", "#FBBF24", "#34D399", "#60A5FA", "#F472B6"],
  chartMuted: "#334155",
  gridLine: "#1E293B",
};

export type Palette = typeof light;

export function usePalette(): Palette {
  const scheme = useColorScheme();
  return scheme === "dark" ? dark : light;
}
