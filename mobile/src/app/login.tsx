import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Stack } from "expo-router/stack";
import { strings, type Locale } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { ApiProblem, login } from "@/utils/api";
import { ActionButton } from "@/components/action-button";
import { Logo } from "@/components/logo";
import { TextField } from "@/components/text-field";
import { usePalette } from "@/theme";

function deviceLocale(): Locale {
  const tag = Intl.DateTimeFormat().resolvedOptions().locale ?? "";
  return tag.toLowerCase().startsWith("he") ? "he" : "en";
}

export default function LoginScreen() {
  const router = useRouter();
  const { setSession } = useSession();
  const locale = deviceLocale();
  const t = strings(locale);
  const colors = usePalette();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await login({
        email: email.trim(),
        password,
        mfaCode: needsMfa ? mfaCode : undefined,
      });
      if ("mfaRequired" in result) {
        setNeedsMfa(true);
        return;
      }
      setSession(result.session);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, gap: 16, direction: locale === "he" ? "rtl" : "ltr" }}
    >
      <Stack.Screen options={{ title: t.signIn, headerShown: false }} />
      <View style={{ paddingTop: 48, paddingBottom: 8 }}>
        <Logo size={44} />
      </View>
      <Text style={{ color: colors.label, fontSize: 28, fontWeight: "700" }}>{t.signIn}</Text>
      <TextField
        label={t.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextField label={t.password} secureTextEntry value={password} onChangeText={setPassword} />
      {needsMfa ? (
        <>
          <Text selectable style={{ color: colors.secondaryLabel, lineHeight: 20 }}>
            {t.mfaHint}
          </Text>
          <TextField label={t.mfa} keyboardType="number-pad" value={mfaCode} onChangeText={setMfaCode} />
        </>
      ) : null}
      {error ? (
        <Text selectable style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      <ActionButton label={pending ? t.loading : t.signIn} onPress={() => void submit()} disabled={pending} />
    </ScrollView>
  );
}
