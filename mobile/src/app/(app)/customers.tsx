import { StyleSheet, Text, View } from "react-native";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { PagedList } from "@/components/paged-list";
import { usePalette } from "@/theme";

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
}

export default function CustomersScreen() {
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const colors = usePalette();

  return (
    <PagedList<CustomerRow>
      path="/api/v1/customers?limit=50"
      empty={t.noCustomers}
      renderItem={(item) => (
        <View
          style={{
            paddingVertical: 14,
            gap: 2,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.separator,
          }}
        >
          <Text style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>{item.name}</Text>
          {item.email ? <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{item.email}</Text> : null}
        </View>
      )}
    />
  );
}
