import { Text, View } from "react-native";
import { usePalette } from "@/theme";

/**
 * "▲ 12%" pill comparing this month to last. `goodWhenUp` flips the
 * coloring: income growing is green, spending growing is red. `onDark`
 * renders translucent white for use on the violet hero card.
 */
export function DeltaChip({
  percent,
  goodWhenUp,
  onDark,
  onTint,
}: {
  percent: number | null;
  goodWhenUp: boolean;
  onDark?: boolean;
  /** Set when the chip sits on an already-tinted card, so it keeps contrast. */
  onTint?: boolean;
}) {
  const colors = usePalette();
  if (percent === null || !Number.isFinite(percent)) return null;

  const up = percent >= 0;
  const good = up === goodWhenUp;
  const background = onDark
    ? "rgba(255,255,255,0.18)"
    : onTint
      ? `${colors.background}B3`
      : good
        ? colors.incomeSoft
        : colors.expenseSoft;
  const color = onDark ? "#FFFFFF" : good ? colors.income : colors.expense;
  const magnitude = Math.min(999, Math.abs(Math.round(percent)));

  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        backgroundColor: background,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2.5,
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: "800" }}>{up ? "▲" : "▼"}</Text>
      <Text style={{ color, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
        {magnitude}%
      </Text>
    </View>
  );
}
