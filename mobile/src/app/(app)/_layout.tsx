import { Stack } from "expo-router/stack";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "@/hooks/use-session";
import { strings } from "@/constants/copy";
import { brand, usePalette } from "@/theme";

export default function AppLayout() {
  const { ready, session } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;
  const t = strings(session.user.locale);
  const direction = session.user.locale === "he" ? "rtl" : "ltr";
  const colors = usePalette();

  return (
    <View style={{ flex: 1, direction, backgroundColor: colors.background }}>
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerTintColor: brand.violet,
          headerStyle: { backgroundColor: colors.background },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="pending" options={{ title: t.pending }} />
        <Stack.Screen name="invoices" options={{ title: t.invoices }} />
        <Stack.Screen name="vendors" options={{ title: t.vendors }} />
        <Stack.Screen name="customers" options={{ title: t.customers }} />
        <Stack.Screen name="documents" options={{ title: t.documents }} />
        <Stack.Screen name="document/[id]" options={{ title: t.documents }} />
        <Stack.Screen name="duplicates" options={{ title: t.duplicates }} />
        <Stack.Screen name="capture" options={{ title: t.addExpense, headerShown: false }} />
        <Stack.Screen name="expense/[id]" options={{ title: t.pending }} />
        <Stack.Screen name="invoice/new" options={{ title: t.sendInvoice }} />
      </Stack>
    </View>
  );
}
