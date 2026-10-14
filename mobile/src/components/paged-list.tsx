import { useCallback, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { ApiProblem, apiJson } from "@/utils/api";
import { brand, usePalette } from "@/theme";

export function PagedList<T extends { id: string }>({
  path,
  empty,
  renderItem,
}: {
  path: string;
  empty: string;
  renderItem: (item: T) => ReactElement;
}) {
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const colors = usePalette();
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await apiJson<{ data: T[] }>(path);
      setRows(page.data);
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
      setRows((current) => current ?? []);
    }
  }, [path, t.error]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <FlatList
      data={rows ?? []}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
      ListHeaderComponent={
        <View style={{ paddingTop: 8, paddingBottom: 8, gap: 8 }}>
          {error ? (
            <Text selectable style={{ color: colors.destructive }}>
              {error}
            </Text>
          ) : null}
          {rows === null ? <ActivityIndicator color={brand.violet} /> : null}
        </View>
      }
      ListEmptyComponent={
        rows === null ? null : (
          <Text style={{ color: colors.secondaryLabel, fontSize: 16, lineHeight: 22 }}>{empty}</Text>
        )
      }
      renderItem={({ item }) => renderItem(item)}
    />
  );
}
