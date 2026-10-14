import { Pressable, Text } from "react-native";
import { brand, usePalette } from "@/theme";

type Variant = "primary" | "secondary" | "danger";

export function ActionButton({
  label,
  onPress,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: Variant;
}) {
  const colors = usePalette();
  const background =
    variant === "primary" ? brand.violet : variant === "danger" ? "transparent" : colors.background;
  const color = variant === "primary" ? brand.onViolet : variant === "danger" ? colors.destructive : colors.label;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderCurve: "continuous",
        borderWidth: variant === "secondary" ? 1 : 0,
        borderColor: colors.separator,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed && variant === "primary" ? brand.violetPressed : background,
        opacity: disabled ? 0.5 : pressed && variant !== "primary" ? 0.7 : 1,
      })}
    >
      <Text style={{ color, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
