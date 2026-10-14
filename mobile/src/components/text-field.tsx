import { Text, TextInput, type TextInputProps, View } from "react-native";
import { usePalette } from "@/theme";

export function TextField({
  label,
  style,
  ...props
}: TextInputProps & { label: string }) {
  const colors = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.secondaryLabel}
        {...props}
        style={[
          {
            backgroundColor: colors.background,
            color: colors.label,
            borderWidth: 1,
            borderColor: colors.separator,
            borderRadius: 12,
            borderCurve: "continuous",
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 16,
          },
          style,
        ]}
      />
    </View>
  );
}
