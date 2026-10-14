import { Pressable, Text, View } from "react-native";
import type { Locale } from "@/constants/copy";
import { formatMoney } from "@/utils/format";
import { usePalette } from "@/theme";

export interface RankRow {
  label: string;
  value: number;
  /** Extra line under the label, e.g. "3 invoices". */
  hint?: string;
  onPress?: () => void;
}

/**
 * Ranked horizontal bars — each row shows its share of the largest value.
 * The classic "top vendors / top customers" visual, tappable per row.
 */
export function RankBars({
  rows,
  currency,
  locale,
  color,
}: {
  rows: RankRow[];
  currency: string;
  locale: Locale;
  color?: string;
}) {
  const colors = usePalette();
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <View style={{ gap: 12 }}>
      {rows.map((row, index) => {
        const barColor = color ?? colors.chart[index % colors.chart.length];
        const body = (
          <View style={{ gap: 5 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
              <Text numberOfLines={1} style={{ flex: 1, color: colors.label, fontSize: 14, fontWeight: "600" }}>
                {row.label}
              </Text>
              <Text
                selectable
                style={{ color: colors.label, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] }}
              >
                {formatMoney(row.value, currency, locale)}
              </Text>
            </View>
            <View style={{ height: 7, borderRadius: 4, backgroundColor: colors.chartMuted, overflow: "hidden" }}>
              <View
                style={{
                  height: "100%",
                  width: `${Math.max(2, (row.value / max) * 100)}%`,
                  borderRadius: 4,
                  backgroundColor: barColor,
                }}
              />
            </View>
            {row.hint ? (
              <Text style={{ color: colors.secondaryLabel, fontSize: 12 }}>{row.hint}</Text>
            ) : null}
          </View>
        );
        return row.onPress ? (
          <Pressable
            key={`${row.label}-${index}`}
            onPress={row.onPress}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            {body}
          </Pressable>
        ) : (
          <View key={`${row.label}-${index}`}>{body}</View>
        );
      })}
    </View>
  );
}
