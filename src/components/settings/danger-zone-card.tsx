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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Loader2, Trash2, Clock, XCircle } from "lucide-react";
import {
  requestAccountDeletion,
  cancelAccountDeletion,
  type DeletionStatus,
} from "@/actions/gdpr-actions";
import { useI18n, useLocaleTag } from "@/lib/i18n/client";

type Step = "intent" | "verify" | "confirm";

type DangerZoneCardProps = {
  hasPassword: boolean;
  initialStatus: DeletionStatus;
};

export function DangerZoneCard({
  hasPassword,
  initialStatus,
}: DangerZoneCardProps) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.settings.dangerZone;
  const localeTag = useLocaleTag();
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState<DeletionStatus>(initialStatus);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("intent");
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  function reset() {
    setStep("intent");
    setPassword("");
    setConfirmText("");
    setError(null);
    setLoading(false);
  }

  function handleOpenChange(next: boolean) {
    if (loading) return;
    setOpen(next);
    if (!next) reset();
  }

  function advanceToVerify() {
    setError(null);
    setStep("verify");
  }

  function advanceToConfirm() {
    setError(null);
    if (hasPassword && password.length === 0) {
      setError(t.enterPasswordError);
      return;
    }
    setStep("confirm");
  }

  async function handleRequest() {
    setError(null);
    if (confirmText !== "DELETE") {
      setError(t.typeDeleteError);
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set("password", password);
      fd.set("confirmation", confirmText);
      const result = await requestAccountDeletion(fd);
      if (!result.ok) {
        setError(result.error);
        if (result.code === "invalid_password") setStep("verify");
        else if (result.code === "invalid_confirmation") setStep("confirm");
        setLoading(false);
        return;
      }
      const scheduledFor = result.scheduledFor;
      const daysRemaining = Math.max(
        0,
        Math.ceil((scheduledFor.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      );
      setStatus({
        requested: true,
        requestedAt: new Date(),
        scheduledFor,
        daysRemaining,
      });
      setOpen(false);
      reset();
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.somethingWentWrong);
      setLoading(false);
    }
  }

  async function handleCancel() {
    setCancelError(null);
    setCancelling(true);
    try {
      const result = await cancelAccountDeletion();
      if (!result.ok) {
        setCancelError(result.error);
        return;
      }
      setStatus({ requested: false });
      startTransition(() => router.refresh());
    } finally {
      setCancelling(false);
    }
  }

  if (status.requested) {
    const dayWord = status.daysRemaining === 1 ? t.dayOne : t.dayMany;
    const list1 =
      status.daysRemaining === 1
        ? t.whatHappensList1One
        : t.whatHappensList1Many.replace(
            "{count}",
            String(status.daysRemaining),
          );
    return (
      <Card className="border-red-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-red-600" />
            <CardTitle className="text-lg text-red-700">
              {t.scheduledTitle}
            </CardTitle>
          </div>
          <CardDescription>
            {t.scheduledDescPart1}
            <strong>{formatDate(status.scheduledFor, localeTag)}</strong>
            {t.scheduledDescPart2}
            <strong>{status.daysRemaining}</strong> {dayWord}
            {t.scheduledDescPart3}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-semibold">{t.whatHappensNext}</p>
            <ul className="mt-2 list-disc space-y-1 ps-5">
              <li>{list1}</li>
              <li>{t.whatHappensList2}</li>
              <li>{t.whatHappensList3}</li>
            </ul>
          </div>
          {cancelError && (
            <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {cancelError}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={handleCancel}
              disabled={cancelling}
              className="bg-green-600 hover:bg-green-700"
            >
              {cancelling ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  {t.cancelling}
                </>
              ) : (
                <>
                  <XCircle className="me-2 h-4 w-4" />
                  {t.cancelKeep}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-red-200">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <CardTitle className="text-lg text-red-700">{t.title}</CardTitle>
        </div>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-red-200 bg-red-50/50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-red-900">
            {t.deleteAllHeading}
          </h3>
          <ul className="mb-4 list-disc space-y-1 ps-5 text-sm text-red-900/80">
            <li>{t.deleteList1}</li>
            <li>{t.deleteList2}</li>
            <li>{t.deleteList3}</li>
            <li>{t.deleteList4}</li>
          </ul>
          <p className="mb-4 text-xs text-red-900/70">{t.deleteFooter}</p>
          <Button
            variant="destructive"
            onClick={() => {
              reset();
              setOpen(true);
            }}
          >
            <Trash2 className="me-2 h-4 w-4" />
            {t.requestButton}
          </Button>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          {step === "intent" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-red-700">
                  <AlertTriangle className="h-5 w-5" />
                  {t.intentTitle}
                </DialogTitle>
                <DialogDescription>{t.intentDescription}</DialogDescription>
              </DialogHeader>
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <p className="font-medium">{t.whatDeletedTitle}</p>
                <ul className="mt-2 list-disc space-y-1 ps-5">
                  <li>{t.whatDeletedList1}</li>
                  <li>{t.whatDeletedList2}</li>
                  <li>{t.whatDeletedList3}</li>
                </ul>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
                  {t.cancel}
                </Button>
                <Button variant="destructive" onClick={advanceToVerify}>
                  {t.understandContinue}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "verify" && (
            <>
              <DialogHeader>
                <DialogTitle className="text-red-700">
                  {t.verifyTitle}
                </DialogTitle>
                <DialogDescription>
                  {hasPassword
                    ? t.verifyDescWithPassword
                    : t.verifyDescNoPassword}
                </DialogDescription>
              </DialogHeader>

              {hasPassword && (
                <div className="space-y-2">
                  <Label htmlFor="gdpr-password">{t.currentPassword}</Label>
                  <Input
                    id="gdpr-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    autoFocus
                  />
                </div>
              )}

              {error && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setStep("intent")}
                  disabled={loading}
                >
                  {t.back}
                </Button>
                <Button
                  variant="destructive"
                  onClick={advanceToConfirm}
                  disabled={loading}
                >
                  {t.continue}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "confirm" && (
            <>
              <DialogHeader>
                <DialogTitle className="text-red-700">
                  {t.confirmTitle}
                </DialogTitle>
                <DialogDescription>
                  {t.confirmDescPart1}
                  <span className="font-mono font-semibold text-red-700">
                    DELETE
                  </span>
                  {t.confirmDescPart2}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="gdpr-confirm">
                  {t.typeDeleteLabelPart1}
                  <span className="font-mono">DELETE</span>
                  {t.typeDeleteLabelPart2}
                </Label>
                <Input
                  id="gdpr-confirm"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  disabled={loading}
                  autoFocus
                  className="font-mono"
                  placeholder="DELETE"
                  dir="ltr"
                />
              </div>

              {error && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setStep("verify")}
                  disabled={loading}
                >
                  {t.back}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRequest}
                  disabled={loading || confirmText !== "DELETE"}
                >
                  {loading ? (
                    <>
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      {t.scheduling}
                    </>
                  ) : (
                    t.scheduleDeletion
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function formatDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
