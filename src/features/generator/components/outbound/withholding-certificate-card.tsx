"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";
import {
  removeWithholdingCertificate,
  updateWithholdingCertificateSettings,
  uploadWithholdingCertificate,
  type WithholdingCertificateError,
} from "@/features/generator/actions/withholding-certificate-actions";

interface Props {
  initial: {
    filename: string | null;
    uploadedAt: string | null;
    validUntil: string | null;
    attach: boolean;
    expired: boolean;
  };
}

export function WithholdingCertificateCard({ initial }: Props) {
  const { dict } = useI18n();
  const L = dict.businessEntity.withholdingCertificate;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState(initial.filename);
  const [uploadedAt, setUploadedAt] = useState(initial.uploadedAt);
  const [validUntil, setValidUntil] = useState(initial.validUntil ?? "");
  const [attach, setAttach] = useState(initial.attach);
  const [expired, setExpired] = useState(initial.expired);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function showError(code: WithholdingCertificateError) {
    setSaved(false);
    setError(L.errors[code]);
  }

  function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setSaved(false);
    const body = new FormData();
    body.set("file", file);
    startTransition(async () => {
      const result = await uploadWithholdingCertificate(body);
      if (!result.ok) {
        showError(result.error);
        return;
      }
      setFilename(file.name);
      setUploadedAt(new Date().toISOString());
      setSaved(true);
      router.refresh();
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  function onRemove() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await removeWithholdingCertificate();
      if (!result.ok) {
        showError(result.error);
        return;
      }
      setFilename(null);
      setUploadedAt(null);
      setValidUntil("");
      setAttach(false);
      setExpired(false);
      setSaved(true);
      router.refresh();
    });
  }

  function onSaveSettings(nextAttach: boolean, nextUntil: string) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateWithholdingCertificateSettings({
        attach: nextAttach,
        validUntil: nextUntil,
      });
      if (!result.ok) {
        showError(result.error);
        return;
      }
      setAttach(nextAttach);
      setValidUntil(nextUntil);
      setExpired(Boolean(nextUntil && nextUntil < new Date().toISOString().slice(0, 10)));
      setSaved(true);
      router.refresh();
    });
  }

  const hasFile = Boolean(filename);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{L.cardTitle}</CardTitle>
        <p className="text-sm text-gray-500">{L.description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />

        {hasFile ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-gray-500" />
              <a
                href="/api/files/withholding-certificate"
                target="_blank"
                rel="noreferrer"
                className="truncate underline"
              >
                {filename}
              </a>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => fileRef.current?.click()}
              >
                {L.replace}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isPending}
                aria-label={L.remove}
                onClick={onRemove}
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => fileRef.current?.click()}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {L.upload}
          </Button>
        )}

        <p className="text-xs text-gray-500">{L.pdfOnly}</p>

        {hasFile && (
          <>
            {uploadedAt && (
              <p className="text-xs text-gray-500">
                {L.uploadedAt}:{" "}
                {new Date(uploadedAt).toLocaleDateString()}
              </p>
            )}
            <div className="max-w-xs space-y-1">
              <Label htmlFor="withholding-valid-until" className="text-xs">
                {L.validUntil}
              </Label>
              <Input
                id="withholding-valid-until"
                type="date"
                value={validUntil}
                disabled={isPending}
                onChange={(e) => {
                  const next = e.target.value;
                  setValidUntil(next);
                  onSaveSettings(attach, next);
                }}
              />
              <p className="text-xs text-gray-500">{L.validUntilHint}</p>
            </div>
            {expired && (
              <p className="text-xs text-amber-800">{L.expired}</p>
            )}
            <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2">
              <div>
                <p className="text-sm font-medium">{L.attachLabel}</p>
                <p className="text-xs text-gray-500">{L.attachHint}</p>
              </div>
              <Switch
                checked={attach}
                disabled={isPending}
                onCheckedChange={(checked) => onSaveSettings(checked, validUntil)}
                aria-label={L.attachLabel}
              />
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && !error && <p className="text-sm text-emerald-700">{L.saved}</p>}
      </CardContent>
    </Card>
  );
}
