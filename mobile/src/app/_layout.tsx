import { Stack } from "expo-router/stack";
import { SessionProvider } from "@/hooks/use-session";
import { brand, usePalette } from "@/theme";

function RootStack() {
  const colors = usePalette();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTintColor: brand.violet,
        headerStyle: { backgroundColor: colors.background },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="login" options={{ title: "InvoLoops" }} />
      <Stack.Screen name="(app)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootStack />
    </SessionProvider>
  );
}
