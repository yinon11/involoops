import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { PagedList } from "@/components/paged-list";
import { StatusPill } from "@/components/status-pill";
import { usePalette } from "@/theme";

interface ExpenseRow {
  id: string;
  status: string;
  vendor_name: string | null;
  suggested_vendor_name: string | null;
  amount: string;
  currency: string | null;
  invoice_date: string | null;
}

export default function InvoicesScreen() {
  const router = useRouter();
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const colors = usePalette();

  return (
    <PagedList<ExpenseRow>
      path="/api/v1/invoices?limit=50"
      empty={t.noInvoices}
      renderItem={(item) => (
        <Pressable
          onPress={() => router.push(`/expense/${item.id}`)}
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
              {item.vendor_name || item.suggested_vendor_name || "—"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <StatusPill status={item.status} />
              {item.invoice_date ? (
                <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{item.invoice_date}</Text>
              ) : null}
            </View>
          </View>
          <Text selectable style={{ color: colors.label, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
            {item.amount} {item.currency ?? ""}
          </Text>
        </Pressable>
      )}
    />
  );
}
