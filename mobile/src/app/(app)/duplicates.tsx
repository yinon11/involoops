import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { ApiProblem, apiJson } from "@/utils/api";
import { brand, usePalette } from "@/theme";

interface Member {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  amount: string;
  currency: string | null;
}

interface Group {
  id: string;
  label: string;
  invoices: Member[];
}

export default function DuplicatesScreen() {
  const router = useRouter();
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const colors = usePalette();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await apiJson<{ data: Group[] }>("/api/v1/duplicates");
      setGroups(body.data);
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
      setGroups([]);
    }
  }, [t.error]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }}>
      {error ? (
        <Text selectable style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      {groups === null ? <ActivityIndicator color={brand.violet} /> : null}
      {groups?.length === 0 ? <Text style={{ color: colors.secondaryLabel, fontSize: 16 }}>{t.noDuplicates}</Text> : null}
      {groups?.map((group) => (
        <View key={group.id} style={{ gap: 4 }}>
          <Text style={{ color: colors.label, fontSize: 17, fontWeight: "700" }}>{group.label}</Text>
          {group.invoices.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => router.push(`/expense/${item.id}`)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 12,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.separator,
                backgroundColor: pressed ? colors.pressed : "transparent",
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.label }}>{item.vendor_name || item.invoice_number || "—"}</Text>
                {item.invoice_date ? <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{item.invoice_date}</Text> : null}
              </View>
              <Text selectable style={{ color: colors.label, fontVariant: ["tabular-nums"] }}>
                {item.amount} {item.currency ?? ""}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
