import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { keepPhoto, uploadExpenseFile, dropOutboxItem } from "@/utils/expenses";
import { ActionButton } from "@/components/action-button";
import { brand, usePalette } from "@/theme";

export default function CaptureScreen() {
  const router = useRouter();
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const colors = usePalette();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>("back");
  const [showCamera, setShowCamera] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { bottom } = useSafeAreaInsets();

  async function send(uri: string, name: string, size?: number) {
    setStatus(t.uploadingFile);
    setError(null);
    try {
      const kept = await keepPhoto(uri, name, size);
      const invoiceId = await uploadExpenseFile(kept, (phase) => {
        setStatus(phase === "reading" ? t.uploading : t.uploadingFile);
      });
      await dropOutboxItem(kept.id);
      router.replace(`/expense/${invoiceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error);
      setStatus(null);
      setShowCamera(false);
    }
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      copyToCacheDirectory: false,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await send(asset.uri, asset.name ?? "invoice.pdf", asset.size);
  }

  async function openCamera() {
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) return;
    }
    setShowCamera(true);
  }

  if (status) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16, backgroundColor: colors.background }}>
        <ActivityIndicator color={brand.violet} />
        <Text style={{ color: colors.label, fontSize: 20, fontWeight: "700", textAlign: "center" }}>{status}</Text>
        <Text style={{ color: colors.secondaryLabel, textAlign: "center", lineHeight: 22 }}>
          {t.readingHint}
        </Text>
        <ActionButton variant="secondary" label={t.home} onPress={() => router.back()} />
      </View>
    );
  }

  if (!showCamera) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16, backgroundColor: colors.background }}>
        <Text style={{ color: colors.label, fontSize: 22, fontWeight: "700", lineHeight: 28 }}>{t.cameraExplain}</Text>
        <ActionButton label={t.chooseFile} onPress={() => void pickFile()} />
        <ActionButton variant="secondary" label={t.takePhoto} onPress={() => void openCamera()} />
        {error ? (
          <Text selectable style={{ color: colors.destructive }}>
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing} mirror={facing === "front"} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom, padding: 24, gap: 12 }}>
        <Pressable
          onPress={() => {
            void (async () => {
              const photo = await cameraRef.current?.takePictureAsync({ quality: 0.8 });
              if (photo?.uri) await send(photo.uri, "invoice.jpg");
            })();
          }}
          style={{
            alignSelf: "center",
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: "white",
          }}
        />
        <ActionButton variant="secondary" label={t.chooseFile} onPress={() => void pickFile()} />
        <ActionButton
          variant="secondary"
          label={facing === "back" ? "Front" : "Back"}
          onPress={() => setFacing((current) => (current === "back" ? "front" : "back"))}
        />
      </View>
    </View>
  );
}
