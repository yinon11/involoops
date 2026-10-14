import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { API_BASE } from "@/utils/api";
import { Logo } from "@/components/logo";
import { ActionButton } from "@/components/action-button";
import { usePalette } from "@/theme";

export default function MoreScreen() {
  const router = useRouter();
  const { session, signOut } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const colors = usePalette();
  const { top } = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, paddingTop: top + 28, paddingHorizontal: 24, gap: 20 }}>
      <Logo size={48} />
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.label, fontSize: 28, fontWeight: "700" }}>
          {session?.user.name || t.appName}
        </Text>
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 16 }}>
          {session?.user.email}
        </Text>
      </View>
      <ActionButton
        variant="danger"
        label={t.signOut}
        onPress={() => {
          void signOut().then(() => router.replace("/login"));
        }}
      />
      <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13, marginTop: "auto", marginBottom: 24 }}>
        {API_BASE}
      </Text>
    </View>
  );
}
