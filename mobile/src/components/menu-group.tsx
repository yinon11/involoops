import { Pressable, StyleSheet, Text, View } from "react-native";
import { brand, usePalette } from "@/theme";

export function MenuGroup({
  items,
}: {
  items: { label: string; hint?: string; detail?: string; onPress: () => void }[];
}) {
  const colors = usePalette();
  return (
    <View style={{ backgroundColor: colors.field, borderRadius: 16, overflow: "hidden" }}>
      {items.map((item, index) => (
        <Pressable
          key={item.label}
          onPress={item.onPress}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 14,
            backgroundColor: pressed ? colors.pressed : "transparent",
            borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: colors.separator,
          })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>{item.label}</Text>
            {item.hint ? <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{item.hint}</Text> : null}
          </View>
          {item.detail ? (
            <Text style={{ color: colors.secondaryLabel, fontVariant: ["tabular-nums"], fontWeight: "600" }}>
              {item.detail}
            </Text>
          ) : null}
          <Text style={{ color: brand.violet, fontSize: 22, fontWeight: "500" }}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}
