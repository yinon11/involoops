import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { brand, usePalette } from "@/theme";

/** Rounded card with a title row; the whole app's chart sections live in these. */
export function SectionCard({
  title,
  action,
  onAction,
  children,
}: {
  title: string;
  /** Short trailing link, e.g. "All vendors". */
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  const colors = usePalette();
  return (
    <View
      style={{
        backgroundColor: colors.field,
        borderRadius: 20,
        borderCurve: "continuous",
        padding: 16,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ flex: 1, color: colors.label, fontSize: 16, fontWeight: "700" }}>{title}</Text>
        {action && onAction ? (
          <Pressable onPress={onAction} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: brand.violet, fontSize: 13, fontWeight: "600" }}>{action} ›</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}
