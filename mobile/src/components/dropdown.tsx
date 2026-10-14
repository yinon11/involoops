import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { SelectList } from "@/components/select-list";
import { brand, usePalette } from "@/theme";

/**
 * Labeled dropdown: a field showing the current choice; tapping opens a
 * bottom sheet with the options (searchable once the list grows).
 */
export function Dropdown<T extends string>({
  label,
  sheetTitle,
  options,
  value,
  onChange,
  placeholder = "—",
  searchPlaceholder,
}: {
  /** Field label above the trigger; omit when the surrounding card already names it. */
  label?: string;
  /** Title of the opened sheet; falls back to `label`. */
  sheetTitle?: string;
  options: { value: T; label: string; hint?: string }[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const colors = usePalette();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value) ?? null;
  const searchable = options.length > 8;
  const shown = query.trim()
    ? options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setOpen(true);
          void Haptics.selectionAsync();
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: pressed ? colors.pressed : colors.background,
          borderWidth: 1,
          borderColor: colors.separator,
          borderRadius: 12,
          borderCurve: "continuous",
          paddingHorizontal: 14,
          paddingVertical: 12,
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: 16,
            fontWeight: selected ? "600" : "400",
            color: selected ? colors.label : colors.secondaryLabel,
          }}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Text style={{ color: brand.violet, fontSize: 13, fontWeight: "800" }}>▼</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={close} />
        <View
          style={{
            backgroundColor: colors.field,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 16,
            paddingBottom: 32,
            gap: 12,
            maxHeight: "72%",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ flex: 1, color: colors.label, fontSize: 17, fontWeight: "700" }}>
              {sheetTitle ?? label}
            </Text>
            <Pressable onPress={close} hitSlop={10}>
              <Text style={{ color: colors.secondaryLabel, fontSize: 17, fontWeight: "700" }}>✕</Text>
            </Pressable>
          </View>
          {searchable ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.secondaryLabel}
              autoCorrect={false}
              style={{
                backgroundColor: colors.background,
                color: colors.label,
                borderWidth: 1,
                borderColor: colors.separator,
                borderRadius: 12,
                borderCurve: "continuous",
                paddingHorizontal: 14,
                paddingVertical: 10,
                fontSize: 16,
              }}
            />
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled">
            <SelectList<T>
              options={shown}
              value={value}
              onChange={(next) => {
                onChange(next);
                close();
              }}
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
