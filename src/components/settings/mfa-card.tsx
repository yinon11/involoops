"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
import { ShieldCheck, Loader2, Copy, Check, Download } from "lucide-react";
import {
  getMfaStatus,
  initiateMfaSetup,
  verifyMfaSetup,
  disableMfa,
  regenerateBackupCodes,
  type MfaStatus,
} from "@/actions/mfa-actions";
import { useI18n, useLocaleTag } from "@/lib/i18n/client";

type MfaCardProps = {
  initialStatus: MfaStatus;
};

export function MfaCard({ initialStatus }: MfaCardProps) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.settings.mfa;
  const localeTag = useLocaleTag();
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState<MfaStatus>(initialStatus);
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);

  async function refresh() {
    const next = await getMfaStatus();
    setStatus(next);
    startTransition(() => router.refresh());
  }

  const backupRemaining =
    status.backupCodesRemaining === 1
      ? t.backupRemainingOne
      : t.backupRemainingMany.replace(
          "{count}",
          String(status.backupCodesRemaining),
        );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">{t.title}</CardTitle>
        </div>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.enabled ? (
          <div className="space-y-4">
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
              <p className="font-medium">{t.enabledHeader}</p>
              <p className="mt-1 text-xs">
                {backupRemaining}
                {status.enabledAt && (
                  <>
                    {t.enabledOn.replace(
                      "{date}",
                      new Date(status.enabledAt).toLocaleDateString(localeTag),
                    )}
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setRegenOpen(true)}
              >
                {t.regenerateBackup}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setDisableOpen(true)}
              >
                {t.disable}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground">
              {t.offIntroPart1}
              <span className="font-semibold text-foreground">
                {t.offIntroLabel}
              </span>
              {t.offIntroPart2}
            </p>
            <Button className="mt-4" onClick={() => setSetupOpen(true)}>
              {t.enable}
            </Button>
          </div>
        )}
      </CardContent>

      {setupOpen && (
        <SetupDialog
          onClose={() => setSetupOpen(false)}
          onSuccess={async () => {
            setSetupOpen(false);
            await refresh();
          }}
        />
      )}
      {disableOpen && (
        <DisableDialog
          onClose={() => setDisableOpen(false)}
          onSuccess={async () => {
            setDisableOpen(false);
            await refresh();
          }}
        />
      )}
      {regenOpen && (
        <RegenerateDialog
          onClose={() => setRegenOpen(false)}
          onSuccess={async () => {
            await refresh();
          }}
        />
      )}
    </Card>
  );
}

// =============================================================================
// Setup dialog — 3 phases: loading QR, verifying, showing backup codes.
// =============================================================================

type SetupPhase = "loading" | "scan" | "codes";

function SetupDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const { dict } = useI18n();
  const t = dict.settings.mfa;
  const [phase, setPhase] = useState<SetupPhase>("loading");
  const [qrDataUri, setQrDataUri] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [savedAck, setSavedAck] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await initiateMfaSetup();
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setQrDataUri(result.qrDataUri);
      setManualKey(result.manualEntryKey);
      setPhase("scan");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = verifyCode.replace(/\s/g, "");
    if (!/^\d{6}$/.test(cleaned)) {
      setError(t.sixDigitInvalid);
      return;
    }
    setVerifying(true);
    setError(null);
    const result = await verifyMfaSetup(cleaned);
    setVerifying(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBackupCodes(result.backupCodes);
    setPhase("codes");
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.setupTitle}</DialogTitle>
          <DialogDescription>{t.setupDescription}</DialogDescription>
        </DialogHeader>

        {phase === "loading" && (
          <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mb-3 h-6 w-6 animate-spin" />
            {t.preparing}
          </div>
        )}

        {phase === "scan" && qrDataUri && manualKey && (
          <form className="space-y-4" onSubmit={handleVerify}>
            <div className="flex justify-center rounded-md border bg-white p-4">
              <Image
                src={qrDataUri}
                alt={t.qrAlt}
                width={208}
                height={208}
                unoptimized
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                {t.manualKeyLabel}
              </Label>
              <ManualKey value={manualKey} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mfa-setup-code">{t.sixDigitCode}</Label>
              <Input
                id="mfa-setup-code"
                inputMode="numeric"
                maxLength={6}
                value={verifyCode}
                onChange={(e) =>
                  setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                dir="ltr"
                autoFocus
                className="text-center font-mono text-lg tracking-[0.35em]"
              />
            </div>
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t.cancel}
              </Button>
              <Button
                type="submit"
                disabled={verifying || verifyCode.length !== 6}
              >
                {verifying ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t.verifying}
                  </>
                ) : (
                  t.verifyEnable
                )}
              </Button>
            </DialogFooter>
          </form>
        )}

        {phase === "codes" && (
          <div className="space-y-4">
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
              {t.backupSaveWarning}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((code) => (
                <code
                  key={code}
                  className="rounded-md border bg-muted px-3 py-2 text-center font-mono text-sm"
                  dir="ltr"
                >
                  {code}
                </code>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => copyToClipboard(backupCodes.join("\n"))}
              >
                <Copy className="me-2 h-4 w-4" />
                {t.copy}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => downloadBackupCodes(backupCodes)}
              >
                <Download className="me-2 h-4 w-4" />
                {t.download}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={savedAck}
                onChange={(e) => setSavedAck(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              {t.savedAck}
            </label>
            <DialogFooter>
              <Button
                disabled={!savedAck}
                onClick={() => void onSuccess()}
              >
                <Check className="me-2 h-4 w-4" />
                {t.finish}
              </Button>
            </DialogFooter>
          </div>
        )}

        {error && phase === "loading" && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManualKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs">
        {value}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          await copyToClipboard(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API unavailable (e.g. insecure context) — swallow silently.
  }
}

function downloadBackupCodes(codes: string[]) {
  const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ttp-invoices-mfa-backup-codes.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =============================================================================
// Disable dialog — password + current code.
// =============================================================================

function DisableDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const { dict } = useI18n();
  const t = dict.settings.mfa;
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await disableMfa({ password, code });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await onSuccess();
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.disableTitle}</DialogTitle>
          <DialogDescription>{t.disableDescription}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="disable-password">{t.passwordLabel}</Label>
            <Input
              id="disable-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="disable-code">{t.authOrBackupLabel}</Label>
            <Input
              id="disable-code"
              type="text"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              dir="ltr"
              placeholder="000000"
            />
          </div>
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={loading || !password || !code}
            >
              {loading ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  {t.disabling}
                </>
              ) : (
                t.disable
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Regenerate backup codes dialog.
// =============================================================================

function RegenerateDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const { dict } = useI18n();
  const t = dict.settings.mfa;
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [savedAck, setSavedAck] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await regenerateBackupCodes(code);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNewCodes(result.backupCodes);
    await onSuccess();
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.regenerateTitle}</DialogTitle>
          <DialogDescription>{t.regenerateDescription}</DialogDescription>
        </DialogHeader>

        {newCodes ? (
          <div className="space-y-4">
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
              {t.regenerateNotice}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {newCodes.map((c) => (
                <code
                  key={c}
                  className="rounded-md border bg-muted px-3 py-2 text-center font-mono text-sm"
                  dir="ltr"
                >
                  {c}
                </code>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => copyToClipboard(newCodes.join("\n"))}
              >
                <Copy className="me-2 h-4 w-4" />
                {t.copy}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => downloadBackupCodes(newCodes)}
              >
                <Download className="me-2 h-4 w-4" />
                {t.download}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={savedAck}
                onChange={(e) => setSavedAck(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              {t.newSavedAck}
            </label>
            <DialogFooter>
              <Button disabled={!savedAck} onClick={onClose}>
                {t.done}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="regen-code">{t.authOrBackupLabel}</Label>
              <Input
                id="regen-code"
                type="text"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                dir="ltr"
                placeholder="000000"
              />
            </div>
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={loading || !code}>
                {loading ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t.working}
                  </>
                ) : (
                  t.regenerate
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
