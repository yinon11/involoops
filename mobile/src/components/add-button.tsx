import { Pressable, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { brand } from "@/theme";

/** Compact violet "＋ label" pill for the top-right of a screen title row. */
export function AddButton({ label, onPress }: { label?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        onPress();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 40,
        minWidth: 40,
        paddingHorizontal: label ? 14 : 0,
        justifyContent: "center",
        borderRadius: 999,
        backgroundColor: pressed ? brand.violetPressed : brand.violet,
      })}
    >
      <Text style={{ color: brand.onViolet, fontSize: 17, fontWeight: "700", marginTop: -1 }}>＋</Text>
      {label ? (
        <Text numberOfLines={1} style={{ color: brand.onViolet, fontSize: 14, fontWeight: "700" }}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}
