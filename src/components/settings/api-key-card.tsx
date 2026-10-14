"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import {
  setUserApiKeyAction,
  removeUserApiKeyAction,
  type SetUserApiKeyResult,
} from "@/actions/user-api-key-actions";
import { useI18n, useLocaleTag } from "@/lib/i18n/client";

interface Props {
  initialStatus: {
    hasKey: boolean;
    hint: string | null;
    validatedAt: Date | null;
    storageConfigured: boolean;
  };
}

type FeedbackState =
  | null
  | { type: "success"; message: string }
  | {
      type: "error";
      message: string;
      /**
       * Set when the failure was a structured server-side rejection (bad
       * key / model gated / etc.). Drives the "Continue with platform
       * key" dismiss CTA — we only show it when the user's stored state
       * was definitely not changed by this failed save.
       */
      dismissible?: boolean;
    };

export function ApiKeyCard({ initialStatus }: Props) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.settings.apiKey;
  const localeTag = useLocaleTag();
  const [isPending, startTransition] = useTransition();
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState<null | "save" | "remove">(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  /**
   * Map the structured `code` returned from the server to a translated
   * message in the current locale. Falls back to the English server text
   * when the code isn't recognised (forward-compat with new error codes).
   */
  function translateSaveError(
    result: Extract<SetUserApiKeyResult, { ok: false }>
  ): string {
    const e = t.saveErrors;
    switch (result.code) {
      case "invalid_format":
        return e.invalidFormat;
      case "storage_unconfigured":
        return e.storageUnconfigured;
      case "model_access":
        return e.modelAccess.replace("{model}", result.model ?? "");
      case "unauthorized":
        return e.unauthorized;
      case "rate_limited":
        return e.rateLimited;
      case "network":
        return e.network;
      default:
        return result.error;
    }
  }

  async function handleSave() {
    setBusy("save");
    setFeedback(null);
    try {
      const result = await setUserApiKeyAction(inputValue);
      if (!result.ok) {
        setFeedback({
          type: "error",
          message: translateSaveError(result),
          dismissible: true,
        });
        return;
      }
      setFeedback({ type: "success", message: t.saveSuccess });
      setInputValue("");
      startTransition(() => router.refresh());
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t.saveFailed,
      });
    } finally {
      setBusy(null);
    }
  }

  function dismissAndKeepPlatformKey() {
    setFeedback(null);
    setInputValue("");
  }

  async function handleRemove() {
    setBusy("remove");
    setFeedback(null);
    try {
      await removeUserApiKeyAction();
      setFeedback({ type: "success", message: t.removeSuccess });
      startTransition(() => router.refresh());
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t.removeFailed,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div id="anthropic-api-key" className="scroll-mt-24">
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t.title}
          </CardTitle>
          {initialStatus.hasKey && (
            <Badge className="bg-emerald-100 text-emerald-800">
              <ShieldCheck className="me-1 h-3 w-3" />
              {t.activeBadge}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t.descriptionPart1}
          <strong>{t.enterprise}</strong>
          {t.descriptionPart2}
          <strong>{t.invoicesAllowance}</strong>
          {t.descriptionPart3}
          <strong>{t.noChargeFromUs}</strong>
          {t.descriptionPart4}
        </p>

        {!initialStatus.storageConfigured && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {t.storageWarningPart1}
            <code>USER_API_KEY_ENCRYPTION_SECRET</code>
            {t.storageWarningPart2}
            <code> AUTH_SECRET</code>
            {t.storageWarningPart3}
          </div>
        )}

        {initialStatus.hasKey ? (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-0.5">
                <p className="text-sm">
                  <span className="text-muted-foreground">{t.keyOnFile}</span>{" "}
                  <code
                    className="rounded bg-muted px-1.5 py-0.5 text-xs"
                    dir="ltr"
                  >
                    sk-ant-{initialStatus.hint ?? "****"}
                  </code>
                </p>
                {initialStatus.validatedAt && (
                  <p className="text-xs text-muted-foreground">
                    {t.validatedAt.replace(
                      "{date}",
                      new Date(initialStatus.validatedAt).toLocaleString(
                        localeTag,
                      ),
                    )}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRemove}
                disabled={busy !== null || isPending}
              >
                {busy === "remove" ? (
                  <Loader2 className="me-1 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="me-1 h-4 w-4" />
                )}
                {t.removeKey}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t.replaceHint}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="anthropic-api-key-input">
                {t.anthropicKeyLabel}
              </Label>
              <Input
                id="anthropic-api-key-input"
                type="password"
                autoComplete="off"
                placeholder="sk-ant-api03-..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={busy !== null || !initialStatus.storageConfigured}
                dir="ltr"
              />
              <p className="text-xs text-muted-foreground">
                {t.anthropicKeyHint}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={
                  busy !== null ||
                  inputValue.trim().length === 0 ||
                  !initialStatus.storageConfigured
                }
                className="bg-indigo-600 hover:bg-indigo-700"
                size="sm"
              >
                {busy === "save" && (
                  <Loader2 className="me-1 h-4 w-4 animate-spin" />
                )}
                {t.verifySaveKey}
              </Button>
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {t.getKey}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}

        {feedback && (
          <div
            className={`rounded-md p-3 text-sm space-y-2 ${
              feedback.type === "success"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            <p>{feedback.message}</p>
            {feedback.type === "error" && feedback.dismissible && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 border-red-200 bg-white text-xs text-red-800 hover:bg-red-100"
                  onClick={dismissAndKeepPlatformKey}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {t.keepUsingPlatformKey}
                </Button>
                <span className="text-[11px] opacity-80">
                  {t.keepUsingPlatformKeyHint}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
