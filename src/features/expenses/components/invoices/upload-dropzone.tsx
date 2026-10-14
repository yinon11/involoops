"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Upload,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Square,
  MinusCircle,
  ExternalLink,
  Clock,
  FileCheck,
  KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useInvoiceUpload,
  type FileStatus,
  type TrackedFile,
} from "@/contexts/invoice-upload-context";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { removeUserApiKeyAction } from "@/actions/user-api-key-actions";

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/tiff",
  "application/zip",
  "application/x-zip-compressed",
];

export function UploadDropzone({
  onComplete,
}: {
  onComplete?: () => void;
}) {
  const { dict, tag } = useI18n();
  const router = useRouter();
  const t = dict.upload.dropzone;
  const {
    files,
    hydrated,
    zipBatchActive,
    allDone,
    isDragOver,
    setIsDragOver,
    handleFiles,
    handleDrop,
    stopZipProcessing,
    clearUploadList,
    retryProcess,
  } = useInvoiceUpload();

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <div
        data-invoice-upload-dropzone
        data-highlight="upload-dropzone"
        data-voice-action="open-file-picker"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50"
        )}
      >
        <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-medium">{t.dragAndDrop}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t.acceptedTypes}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={[...ACCEPTED_TYPES, ".zip"].join(",")}
          className="hidden"
          data-voice-action="open-file-picker"
          data-voice-field="upload-file"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {zipBatchActive && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <p className="text-amber-950">{t.zipInProgress}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-amber-300 bg-white hover:bg-amber-100"
            onClick={stopZipProcessing}
          >
            <Square className="me-1.5 h-3.5 w-3.5 fill-current" />
            {t.stop}
          </Button>
        </div>
      )}

      {!hydrated && (
        <p className="text-sm text-muted-foreground">{t.loading}</p>
      )}

      {hydrated && files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-start gap-3 rounded-md border p-3"
            >
              <StatusIcon status={f.status} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate text-sm font-medium">{f.name}</p>
                {f.status === "done" && f.invoiceId ? (
                  <>
                    {f.invoiceStatus === "approved" ? (
                      <Badge
                        variant="secondary"
                        className="border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                      >
                        {t.autoApproved}
                      </Badge>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t.pendingReview}
                      </p>
                    )}
                    {f.possibleDuplicateInvoiceId && (
                      <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          {t.duplicateWarning}{" "}
                          <Link
                            href={`/invoices/${f.possibleDuplicateInvoiceId}`}
                            className="font-medium underline underline-offset-2"
                          >
                            {t.viewExistingInvoice}
                          </Link>
                          .
                        </span>
                      </div>
                    )}
                    <DoneInvoiceSummary f={f} dict={dict} tag={tag} />
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {statusLabel(f.status, dict, f.error)}
                    </p>
                    {f.status === "error" &&
                      f.errorCode === "anthropic_model_access" &&
                      f.retryContext && (
                        <ByokFallbackBanner
                          fileId={f.id}
                          retry={retryProcess}
                          onSwitched={() => router.refresh()}
                          dict={dict}
                        />
                      )}
                  </>
                )}
              </div>
              {(f.status === "uploading" || f.status === "processing") && (
                <div className="h-1.5 w-20 shrink-0 overflow-hidden self-center rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${f.progress}%` }}
                  />
                </div>
              )}
              {f.status === "error" && f.duplicateInvoiceId && (
                <Link
                  href={`/invoices/${f.duplicateInvoiceId}`}
                  className="shrink-0 self-center"
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t.viewDuplicate}
                  </Button>
                </Link>
              )}
              {f.status === "done" && f.invoiceId && (
                <Link
                  href={
                    f.invoiceStatus === "approved"
                      ? `/invoices/${f.invoiceId}`
                      : `/pending?invoice=${f.invoiceId}`
                  }
                  className="shrink-0 self-center"
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                  >
                    {f.invoiceStatus === "approved" ? (
                      <>
                        <FileCheck className="h-3 w-3" />
                        {t.viewInvoice}
                      </>
                    ) : (
                      <>
                        <Clock className="h-3 w-3" />
                        {t.viewInPending}
                      </>
                    )}
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {hydrated && allDone && files.length > 0 && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => clearUploadList()}
          >
            {t.clearList}
          </Button>
          {onComplete && (
            <Button onClick={onComplete} size="sm">
              {t.done}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: FileStatus }) {
  switch (status) {
    case "uploading":
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    case "processing":
      return <Loader2 className="h-5 w-5 animate-spin text-amber-500" />;
    case "done":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "error":
      return <AlertCircle className="h-5 w-5 text-red-500" />;
    case "cancelled":
      return <MinusCircle className="h-5 w-5 text-muted-foreground" />;
    case "interrupted":
      return <AlertCircle className="h-5 w-5 text-amber-600" />;
  }
}

function statusLabel(
  status: FileStatus,
  dict: Dictionary,
  error?: string
): string {
  const t = dict.upload.dropzone.statusLabel;
  switch (status) {
    case "uploading":
      return t.uploading;
    case "processing":
      return t.extracting;
    case "done":
      return t.complete;
    case "error":
      return error ?? t.failed;
    case "cancelled":
      return error ?? t.stopped;
    case "interrupted":
      return error ?? t.interrupted;
  }
}

function DoneInvoiceSummary({
  f,
  dict,
  tag,
}: {
  f: TrackedFile;
  dict: Dictionary;
  tag: string;
}) {
  const t = dict.upload.dropzone.summary;
  const currency = f.currency ?? "ILS";
  const vendor = f.vendorDisplayName?.trim() || "—";
  const dateLabel = formatInvoiceDate(f.invoiceDate, tag) ?? "—";
  const total =
    f.amount != null && f.amount !== ""
      ? formatMoney(f.amount, currency, tag)
      : "—";
  const vat =
    f.vatAmount != null && f.vatAmount !== ""
      ? formatMoney(f.vatAmount, currency, tag)
      : "—";

  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
      <dt className="font-medium text-foreground/80">{t.vendor}</dt>
      <dd className="truncate" title={vendor !== "—" ? vendor : undefined}>
        {vendor}
      </dd>
      <dt className="font-medium text-foreground/80">{t.date}</dt>
      <dd>{dateLabel}</dd>
      <dt className="font-medium text-foreground/80">{t.total}</dt>
      <dd>{total}</dd>
      <dt className="font-medium text-foreground/80">{t.vat}</dt>
      <dd>{vat}</dd>
    </dl>
  );
}

function formatInvoiceDate(
  iso: string | null | undefined,
  tag: string
): string | null {
  if (!iso) return null;
  const normalized = iso.length <= 10 ? `${iso}T12:00:00` : iso;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(tag, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMoney(amount: string, currency: string, tag: string): string {
  const n = Number.parseFloat(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(tag, {
      style: "currency",
      currency: currency || "ILS",
    }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * Inline recovery CTA for the BYOK "Anthropic key can't access the
 * extraction model" failure. The bytes are already in MinIO, so removing
 * the user's stored Anthropic key and re-running the process step is
 * enough — no re-upload needed.
 */
function ByokFallbackBanner({
  fileId,
  retry,
  onSwitched,
  dict,
}: {
  fileId: string;
  retry: (id: string) => Promise<"ok" | "error" | "missing">;
  onSwitched: () => void;
  dict: Dictionary;
}) {
  const t = dict.upload.dropzone.byokFallback;
  const [busy, setBusy] = useState(false);

  async function handleSwitch() {
    setBusy(true);
    try {
      const removed = await removeUserApiKeyAction();
      if (!removed.ok) {
        toast.error(t.switchFailed);
        return;
      }
      // BYOK is now off → tier reverts to the user's paid/free
      // subscription on the next request. Re-running process picks up
      // the platform Anthropic key automatically.
      const result = await retry(fileId);
      if (result === "ok") {
        toast.success(t.retrySuccess);
        onSwitched();
      } else if (result === "missing") {
        toast.error(t.retryMissing);
      } else {
        toast.error(t.retryFailed);
        // Still revalidate — the BYOK was removed even though retry
        // failed, so the settings page should reflect that.
        onSwitched();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.switchFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p className="leading-snug">{t.body}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 border-amber-300 bg-white text-xs hover:bg-amber-100"
          onClick={handleSwitch}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <KeyRound className="h-3 w-3" />
          )}
          {busy ? t.switching : t.usePlatformKey}
        </Button>
        <Link
          href="/settings#anthropic-api-key"
          className="text-[11px] underline underline-offset-2 hover:text-amber-950"
        >
          {t.manageKey}
        </Link>
      </div>
    </div>
  );
}
