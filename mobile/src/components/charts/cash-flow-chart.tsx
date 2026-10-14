import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { G, Rect } from "react-native-svg";
import * as Haptics from "expo-haptics";
import type { Locale } from "@/constants/copy";
import { formatMoney, formatMonthLong, formatMonthShort } from "@/utils/format";
import { usePalette } from "@/theme";

export interface CashFlowMonth {
  month: string;
  money_in: number;
  money_out: number;
}

const BAR_RADIUS = 3;
const CHART_HEIGHT = 132;
const BASELINE = 2;

/**
 * Six months of money in vs money out as paired bars. Tapping a month pins
 * its exact numbers above the chart; the latest month starts selected.
 */
export function CashFlowChart({
  months,
  currency,
  locale,
  series = "both",
  inLabel,
  outLabel,
}: {
  months: CashFlowMonth[];
  currency: string;
  locale: Locale;
  series?: "both" | "in" | "out";
  inLabel: string;
  outLabel: string;
}) {
  const colors = usePalette();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(months.length - 1);

  const showIn = series !== "out";
  const showOut = series !== "in";
  const max = Math.max(
    1,
    ...months.flatMap((row) => [showIn ? row.money_in : 0, showOut ? row.money_out : 0]),
  );
  const slot = width > 0 ? width / months.length : 0;
  const barWidth = Math.min(16, Math.max(6, slot * (showIn && showOut ? 0.22 : 0.34)));
  const gap = showIn && showOut ? 3 : 0;
  const scale = (value: number) =>
    value <= 0 ? 0 : Math.max(2, (value / max) * (CHART_HEIGHT - BASELINE));

  const current = months[selected] ?? months[months.length - 1];

  return (
    <View style={{ gap: 12 }}>
      {current ? (
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>
            {formatMonthLong(current.month, locale)}
          </Text>
          {showIn ? (
            <LegendValue
              color={colors.income}
              label={inLabel}
              value={formatMoney(current.money_in, currency, locale)}
            />
          ) : null}
          {showOut ? (
            <LegendValue
              color={colors.expense}
              label={outLabel}
              value={formatMoney(current.money_out, currency, locale)}
            />
          ) : null}
        </View>
      ) : null}
      <View
        style={{ height: CHART_HEIGHT + 26 }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <>
            <Svg width={width} height={CHART_HEIGHT}>
              <Rect x={0} y={CHART_HEIGHT - 1} width={width} height={1} fill={colors.gridLine} />
              {months.map((row, index) => {
                const center = slot * index + slot / 2;
                const pairWidth = showIn && showOut ? barWidth * 2 + gap : barWidth;
                const start = center - pairWidth / 2;
                const dim = index !== selected;
                const inHeight = scale(row.money_in);
                const outHeight = scale(row.money_out);
                return (
                  <G key={row.month}>
                    {showIn ? (
                      <Rect
                        x={start}
                        y={CHART_HEIGHT - inHeight}
                        width={barWidth}
                        height={inHeight}
                        rx={BAR_RADIUS}
                        fill={colors.income}
                        opacity={dim ? 0.38 : 1}
                      />
                    ) : null}
                    {showOut ? (
                      <Rect
                        x={showIn ? start + barWidth + gap : start}
                        y={CHART_HEIGHT - outHeight}
                        width={barWidth}
                        height={outHeight}
                        rx={BAR_RADIUS}
                        fill={colors.expense}
                        opacity={dim ? 0.38 : 1}
                      />
                    ) : null}
                  </G>
                );
              })}
            </Svg>
            <View style={{ position: "absolute", inset: 0, flexDirection: "row" }}>
              {months.map((row, index) => (
                <Pressable
                  key={row.month}
                  style={{ flex: 1, justifyContent: "flex-end" }}
                  onPress={() => {
                    setSelected(index);
                    void Haptics.selectionAsync();
                  }}
                >
                  <Text
                    style={{
                      textAlign: "center",
                      fontSize: 11,
                      fontWeight: index === selected ? "700" : "500",
                      color: index === selected ? colors.label : colors.secondaryLabel,
                      paddingTop: 8,
                    }}
                  >
                    {formatMonthShort(row.month, locale)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

function LegendValue({ color, label, value }: { color: string; label: string; value: string }) {
  const colors = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{label}</Text>
      <Text
        selectable
        style={{ color: colors.label, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}
