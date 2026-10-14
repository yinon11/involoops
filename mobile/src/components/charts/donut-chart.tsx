import { Fragment } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { Locale } from "@/constants/copy";
import { formatMoney, formatMoneyCompact } from "@/utils/format";
import { usePalette } from "@/theme";

export interface DonutSlice {
  label: string;
  value: number;
  onPress?: () => void;
}

const SIZE = 148;
const STROKE = 17;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Small breathing gap between slices, in fractions of the circle. */
const GAP = 0.012;

/**
 * Donut of up to six slices with the total in the hole and a tappable
 * legend beside it. Slices below ~1% are dropped rather than drawn as slivers.
 */
export function DonutChart({
  slices,
  currency,
  locale,
  centerLabel,
}: {
  slices: DonutSlice[];
  currency: string;
  locale: Locale;
  centerLabel: string;
}) {
  const colors = usePalette();
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  if (total <= 0) return null;

  const visible = slices.filter((slice) => slice.value / total >= 0.01);
  let position = 0;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
      <View style={{ width: SIZE, height: SIZE }}>
        <Svg width={SIZE} height={SIZE}>
          {visible.map((slice, index) => {
            const fraction = slice.value / total;
            const arc = Math.max(0, fraction - GAP);
            const dash = `${arc * CIRCUMFERENCE} ${CIRCUMFERENCE}`;
            const offset = -position * CIRCUMFERENCE;
            position += fraction;
            return (
              <Circle
                key={`${slice.label}-${index}`}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                stroke={colors.chart[index % colors.chart.length]}
                strokeWidth={STROKE}
                strokeDasharray={dash}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                fill="none"
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              />
            );
          })}
        </Svg>
        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 11, fontWeight: "600" }}>
            {centerLabel}
          </Text>
          <Text
            selectable
            style={{ color: colors.label, fontSize: 17, fontWeight: "800", fontVariant: ["tabular-nums"] }}
          >
            {formatMoneyCompact(total, currency, locale)}
          </Text>
        </View>
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        {visible.map((slice, index) => {
          const row = (
            <Fragment>
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 3,
                  backgroundColor: colors.chart[index % colors.chart.length],
                }}
              />
              <Text numberOfLines={1} style={{ flex: 1, color: colors.label, fontSize: 13, fontWeight: "600" }}>
                {slice.label}
              </Text>
              <Text
                style={{ color: colors.secondaryLabel, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] }}
              >
                {formatMoney(slice.value, currency, locale)}
              </Text>
            </Fragment>
          );
          const style = { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 };
          return slice.onPress ? (
            <Pressable key={`${slice.label}-${index}`} onPress={slice.onPress} hitSlop={6} style={style}>
              {row}
            </Pressable>
          ) : (
            <View key={`${slice.label}-${index}`} style={style}>
              {row}
            </View>
          );
        })}
      </View>
    </View>
  );
}
