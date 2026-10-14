import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { brand, usePalette } from "@/theme";

/**
 * Single-select list: one bordered group, one row per option, a violet
 * checkmark on the chosen one. The picker for anything too long or too
 * wordy to be a chip row.
 */
export function SelectList<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const colors = usePalette();
  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderRadius: 14,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.separator,
        overflow: "hidden",
      }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              onChange(option.value);
              void Haptics.selectionAsync();
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 14,
              paddingVertical: 13,
              backgroundColor: pressed ? colors.pressed : "transparent",
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: colors.separator,
            })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: selected ? brand.violet : colors.label,
                  fontSize: 16,
                  fontWeight: selected ? "700" : "500",
                }}
              >
                {option.label}
              </Text>
              {option.hint ? (
                <Text numberOfLines={1} style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                  {option.hint}
                </Text>
              ) : null}
            </View>
            {selected ? (
              <Text style={{ color: brand.violet, fontSize: 17, fontWeight: "800" }}>✓</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
