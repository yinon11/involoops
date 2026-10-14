import { StyleSheet, Text, View } from "react-native";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { PagedList } from "@/components/paged-list";
import { usePalette } from "@/theme";

interface VendorRow {
  id: string;
  name: string;
}

export default function VendorsScreen() {
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const colors = usePalette();

  return (
    <PagedList<VendorRow>
      path="/api/v1/vendors?limit=50"
      empty={t.noVendors}
      renderItem={(item) => (
        <View
          style={{
            paddingVertical: 14,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.separator,
          }}
        >
          <Text style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>{item.name}</Text>
        </View>
      )}
    />
  );
}
