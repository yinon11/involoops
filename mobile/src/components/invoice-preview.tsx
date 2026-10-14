import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Image } from "expo-image";
import { WebView } from "react-native-webview";
import { brand, usePalette } from "@/theme";

/**
 * Photos render in the image view. A PDF does not — Android leaves the
 * box empty — so the first page is drawn in a web view instead.
 */
export function InvoicePreview({ url, failedLabel }: { url: string; failedLabel: string }) {
  const colors = usePalette();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [pdfHtml, setPdfHtml] = useState<string | null>(null);
  const [pdfHeight, setPdfHeight] = useState(480);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setImageUri(null);
    setPdfHtml(null);
    setError(null);

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(failedLabel);
        const type = response.headers.get("content-type") ?? "";
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        if (type.startsWith("image/")) {
          setImageUri(`data:${type};base64,${bytesToBase64(bytes)}`);
          return;
        }
        setPdfHtml(pdfPageHtml(bytesToBase64(bytes)));
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setError(failedLabel);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, failedLabel]);

  if (error) {
    return (
      <Text selectable style={{ color: colors.destructive }}>
        {error}
      </Text>
    );
  }

  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={{ height: 280, borderRadius: 12, backgroundColor: colors.field }}
        contentFit="contain"
      />
    );
  }

  if (pdfHtml) {
    return (
      <View style={{ height: pdfHeight, borderRadius: 12, overflow: "hidden", backgroundColor: colors.field }}>
        <WebView
          originWhitelist={["*"]}
          source={{ html: pdfHtml, baseUrl: "https://cdnjs.cloudflare.com/" }}
          style={{ flex: 1, backgroundColor: colors.field }}
          scrollEnabled={false}
          nestedScrollEnabled
          setSupportMultipleWindows={false}
          onMessage={(event) => {
            const message = event.nativeEvent.data;
            if (message.startsWith("h:")) {
              const next = Number(message.slice(2));
              if (Number.isFinite(next) && next > 80) setPdfHeight(Math.min(next, 900));
              return;
            }
            setError(failedLabel);
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ height: 220, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.field }}>
      <ActivityIndicator color={brand.violet} />
    </View>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(binary);
}

function pdfPageHtml(base64: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<style>html, body { margin: 0; background: transparent; } canvas { display: block; width: 100%; height: auto; }</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
<canvas id="page"></canvas>
<script>
  function fail(err) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(String(err && err.message || err));
  }
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    var raw = atob("${base64}");
    var data = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
    pdfjsLib.getDocument({ data: data }).promise.then(function (pdf) {
      return pdf.getPage(1);
    }).then(function (page) {
      var canvas = document.getElementById("page");
      var unscaled = page.getViewport({ scale: 1 });
      var width = document.documentElement.clientWidth || unscaled.width;
      var viewport = page.getViewport({ scale: width / unscaled.width });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      return page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise.then(function () {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage("h:" + Math.ceil(viewport.height));
      });
    }).catch(fail);
  } catch (err) {
    fail(err);
  }
</script>
</body>
</html>`;
}
