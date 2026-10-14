import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { PagedList } from "@/components/paged-list";
import { StatusPill } from "@/components/status-pill";
import { brand, usePalette } from "@/theme";

interface DocumentRow {
  id: string;
  formatted_number: string | null;
  draft_reference: string | null;
  customer_name: string | null;
  invoice_date: string;
  total: string;
  currency: string | null;
  status: string;
}

export default function DocumentsScreen() {
  const router = useRouter();
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const colors = usePalette();

  return (
    <PagedList<DocumentRow>
      path="/api/v1/outbound-invoices?limit=50"
      empty={t.noDocuments}
      renderItem={(item) => (
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/document/[id]",
              params: { id: item.id, name: item.customer_name ?? "" },
            })
          }
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 14,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.separator,
            backgroundColor: pressed ? colors.pressed : "transparent",
          })}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>
              {item.customer_name || item.formatted_number || item.draft_reference || "—"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <StatusPill status={item.status} />
              <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                {[item.formatted_number ?? item.draft_reference, item.invoice_date].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </View>
          <Text selectable style={{ color: colors.label, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
            {item.total} {item.currency ?? ""}
          </Text>
          <Text style={{ color: brand.violet, fontSize: 22, fontWeight: "500" }}>›</Text>
        </Pressable>
      )}
    />
  );
}
