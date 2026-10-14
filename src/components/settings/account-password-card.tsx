"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, KeyRound } from "lucide-react";
import { updateAccountPassword } from "@/actions/account-password-actions";
import { useI18n } from "@/lib/i18n/client";

type AccountPasswordCardProps = {
  hasGoogleLinked: boolean;
  hasPassword: boolean;
};

export function AccountPasswordCard({
  hasGoogleLinked,
  hasPassword,
}: AccountPasswordCardProps) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.settings.accountPassword;
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  if (!hasGoogleLinked && !hasPassword) {
    return null;
  }

  const isInitialSetup = hasGoogleLinked && !hasPassword;

  const title = isInitialSetup ? t.titleAdd : t.titleChange;
  const description = isInitialSetup
    ? t.descAdd
    : hasGoogleLinked
      ? t.descChangeWithGoogle
      : t.descChange;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (newPassword.length < 8) {
      setFeedback({
        type: "error",
        message: t.tooShort,
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setFeedback({ type: "error", message: t.mismatch });
      return;
    }

    const fd = new FormData();
    fd.set("newPassword", newPassword);
    fd.set("confirmPassword", confirmPassword);
    if (hasPassword) {
      fd.set("currentPassword", currentPassword);
    }

    try {
      const result = await updateAccountPassword(fd);
      if (result.error) {
        setFeedback({ type: "error", message: result.error });
        return;
      }
      setFeedback({
        type: "success",
        message: isInitialSetup ? t.successAdd : t.successUpdate,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      startTransition(() => router.refresh());
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t.genericError,
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="max-w-md space-y-4"
        >
          {feedback && (
            <div
              className={
                feedback.type === "success"
                  ? "rounded-md bg-green-50 p-3 text-sm text-green-800"
                  : "rounded-md bg-red-50 p-3 text-sm text-red-700"
              }
            >
              {feedback.message}
            </div>
          )}
          {hasPassword && (
            <div className="space-y-2">
              <Label htmlFor="current-password">{t.currentPassword}</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={isPending}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-password">{t.newPassword}</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isPending}
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{t.confirmPassword}</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isPending}
              minLength={8}
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t.saving}
              </>
            ) : isInitialSetup ? (
              t.savePassword
            ) : (
              t.updatePassword
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
