"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle,
  XCircle,
  Save,
  Loader2,
  RefreshCw,
  Scissors,
  AlertCircle,
} from "lucide-react";
import { ProblemReportModal } from "./problem-report-modal";
import {
  approveInvoice,
  reExtractInvoice,
  rejectInvoice,
  updateInvoice,
} from "@/features/expenses/actions/invoice-actions";
import { splitPendingInvoice } from "@/actions/upload-actions";
import { invoicePreviewRequestSrc } from "@/lib/file-preview";
import { InvoicePreviewFrame } from "@/features/expenses/components/invoices/invoice-preview-frame";
import { VendorResolutionPanel } from "@/features/expenses/components/invoices/vendor-resolution-panel";
import { DeleteInvoiceButton } from "@/features/expenses/components/invoices/delete-invoice-button";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface PendingInvoice {
  id: string;
  vendorId: string | null;
  /** Extracted name when no vendor matched; must be resolved before save/approve. */
  suggestedVendorName: string | null;
  vendorName: string | null;
  type: string | null;
  status: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: string;
  currency: string | null;
  vatAmount: string | null;
  amountWithoutVat: string | null;
  description: string | null;
  fileUrl: string | null;
  fileName: string | null;
  /** PDF page count; when > 1 the Split button is offered. NULL = unknown (legacy rows). */
  pageCount: number | null;
  extractionConfidence: string | null;
  extractionMethod: string | null;
  createdAt: Date | null;
}

interface ReviewCardProps {
  invoice: PendingInvoice;
  /** Link or create vendor when extraction suggested a name. */
  vendors?: {
    id: string;
    name: string;
    isIncomeSource: boolean;
    autoApprove?: boolean;
  }[];
  /**
   * User-level toggle: when true, suppresses the post-approve "auto-approve
   * future invoices from this vendor?" dialog entirely.
   */
  suppressAutoApprovePrompt?: boolean;
  selected?: boolean;
  onSelectChange?: (selected: boolean) => void;
  onActionComplete?: () => void;
  /**
   * Fires when an approval succeeds with no edits to the extracted fields and
   * the vendor isn't already auto-approving. The parent (ApprovalQueue) owns
   * the prompt UI because revalidatePath unmounts this card on approve.
   */
  onAutoApproveCandidate?: (vendor: { id: string; name: string }) => void;
  /** After delete succeeds (e.g. clear bulk selection). */
  onInvoiceDeleted?: () => void;
}

interface FormData {
  invoiceDate: string;
  vendorName: string;
  amount: string;
  currency: string;
  vatAmount: string;
  invoiceNumber: string;
  type: string;
  description: string;
}

function confidenceColor(confidence: number): string {
  if (confidence > 0.8) return "bg-green-100 text-green-800 border-green-200";
  if (confidence >= 0.6)
    return "bg-yellow-100 text-yellow-800 border-yellow-200";
  return "bg-red-100 text-red-800 border-red-200";
}

/** DB stores `yyyy-mm-dd`; the pending review form displays `yyyy/mm/dd`. */
function dbDateToDisplay(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[1]}/${match[2]}/${match[3]}`;
}

function displayDateToDb(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(trimmed);
  if (!match) return trimmed;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function confidenceLabel(
  confidence: number,
  labels: Dictionary["reviewCard"]["confidence"]
): string {
  if (confidence > 0.8) return labels.high;
  if (confidence >= 0.6) return labels.medium;
  return labels.low;
}

export function ReviewCard({
  invoice,
  vendors = [],
  suppressAutoApprovePrompt = false,
  selected,
  onSelectChange,
  onActionComplete,
  onAutoApproveCandidate,
  onInvoiceDeleted,
}: ReviewCardProps) {
  const { dict } = useI18n();
  const t = dict.reviewCard;
  const needsVendorResolution =
    !invoice.vendorId && !!invoice.suggestedVendorName?.trim();
  // Override mode: invoice already has a matched vendor but the user wants
  // to swap it for a different one (or create a new one). Hidden behind a
  // toggle so the common "match was correct" case stays uncluttered.
  const canOverrideVendor = !!invoice.vendorId && !needsVendorResolution;

  const [loading, setLoading] = useState<
    "approve" | "reject" | "save" | "reextract" | "split" | null
  >(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showVendorOverride, setShowVendorOverride] = useState(false);
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [showProblemDialog, setShowProblemDialog] = useState(false);

  // Gate: only PDFs with >1 page can carry more than one receipt. NULL
  // pageCount (legacy rows extracted before this column existed) also
  // qualifies — the server re-validates the page count anyway.
  const canSplit =
    !!invoice.fileUrl?.trim() &&
    (invoice.pageCount == null || invoice.pageCount > 1);

  const confidence = invoice.extractionConfidence
    ? parseFloat(invoice.extractionConfidence)
    : 0;

  const previewSrc = invoice.fileUrl
    ? invoicePreviewRequestSrc(invoice.id)
    : null;

  const { register, handleSubmit, setValue, watch, getValues } = useForm<FormData>({
    // `values` (not `defaultValues`) so the form re-syncs when the parent
    // passes fresh `invoice` props after router.refresh() — otherwise a
    // Re-generate that flipped expense↔income would only show up after a
    // hard reload. `keepDirtyValues` protects any in-progress user edits.
    values: {
      invoiceDate: dbDateToDisplay(invoice.invoiceDate),
      vendorName:
        invoice.vendorName ?? invoice.suggestedVendorName ?? "",
      amount: invoice.amount ?? "0",
      currency: invoice.currency ?? "ILS",
      vatAmount: invoice.vatAmount ?? "",
      invoiceNumber: invoice.invoiceNumber ?? "",
      type: invoice.type ?? "expense",
      description: invoice.description ?? "",
    },
    resetOptions: {
      keepDirtyValues: true,
    },
  });

  const currencyValue = watch("currency");
  const typeValue = watch("type");

  // Snapshot the form values as they were extracted/loaded so we can detect
  // "approved without changes." Frozen on first render and never updated; an
  // edit followed by a save would otherwise reset the baseline and make the
  // approval look untouched.
  const initialFormSnapshotRef = useRef<FormData>({
    invoiceDate: dbDateToDisplay(invoice.invoiceDate),
    vendorName: invoice.vendorName ?? invoice.suggestedVendorName ?? "",
    amount: invoice.amount ?? "0",
    currency: invoice.currency ?? "ILS",
    vatAmount: invoice.vatAmount ?? "",
    invoiceNumber: invoice.invoiceNumber ?? "",
    type: invoice.type ?? "expense",
    description: invoice.description ?? "",
  });

  async function persistInvoiceFields(data: FormData) {
    const result = await updateInvoice(invoice.id, {
      invoiceDate: displayDateToDb(data.invoiceDate),
      // Only forward vendorName edits when the inline Vendor input is in
      // use. During needsVendorResolution the form field is disabled and
      // vendor linking is handled exclusively by VendorResolutionPanel, so
      // we don't want to smuggle in a stale value from the hidden input.
      ...(needsVendorResolution ? {} : { vendorName: data.vendorName }),
      amount: data.amount,
      currency: data.currency,
      vatAmount: data.vatAmount || undefined,
      invoiceNumber: data.invoiceNumber,
      type: data.type as "expense" | "income",
      description: data.description,
    });
    // Re-throw client-side so the surrounding try/catch surfaces the
    // server's validation message in the feedback area. Necessary because
    // Next.js production redacts thrown server-action errors.
    if (!result.success) throw new Error(result.error);
  }

  async function handleSave(data: FormData) {
    if (needsVendorResolution) {
      setFeedback({
        type: "error",
        message: t.feedback.vendorRequiredSave,
      });
      return;
    }
    setLoading("save");
    setFeedback(null);
    try {
      await persistInvoiceFields(data);
      setFeedback({ type: "success", message: t.feedback.saved });
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t.feedback.saveFailed,
      });
    } finally {
      setLoading(null);
    }
  }

  function isUnchangedFromSnapshot(data: FormData): boolean {
    const snap = initialFormSnapshotRef.current;
    return (
      data.invoiceDate === snap.invoiceDate &&
      data.vendorName === snap.vendorName &&
      data.amount === snap.amount &&
      data.currency === snap.currency &&
      data.vatAmount === snap.vatAmount &&
      data.invoiceNumber === snap.invoiceNumber &&
      data.type === snap.type &&
      data.description === snap.description
    );
  }

  async function handleApprove() {
    if (needsVendorResolution) {
      setFeedback({
        type: "error",
        message: t.feedback.vendorRequiredApprove,
      });
      return;
    }
    setLoading("approve");
    setFeedback(null);
    try {
      const data = getValues();
      const unchanged = isUnchangedFromSnapshot(data);
      await persistInvoiceFields(data);
      const result = await approveInvoice(invoice.id);
      if (!result.success) throw new Error(result.error);
      setFeedback({ type: "success", message: t.feedback.approved });

      // Offer auto-approve for the matched vendor only when the user did not
      // touch any extracted field, the vendor isn't already auto-approving,
      // and the user hasn't dismissed the prompt globally. The dialog itself
      // lives in ApprovalQueue — approveInvoice() calls revalidatePath() and
      // would unmount this card before the user could see a local dialog.
      const matchedVendor = invoice.vendorId
        ? vendors.find((v) => v.id === invoice.vendorId)
        : null;
      const willPromptAutoApprove =
        unchanged &&
        !suppressAutoApprovePrompt &&
        matchedVendor != null &&
        !matchedVendor.autoApprove;
      if (willPromptAutoApprove && matchedVendor) {
        // Defer onActionComplete to ApprovalQueue.closeAutoApprovePrompt so the
        // pending list isn't refreshed (and this card unmounted) while the
        // prompt is on screen — otherwise a redirect from pending/page.tsx
        // (e.g. last invoice on the last page) tears down the dialog before
        // the user can read it.
        onAutoApproveCandidate?.({
          id: matchedVendor.id,
          name: matchedVendor.name,
        });
      } else {
        onActionComplete?.();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : t.feedback.approvalFailed,
      });
    } finally {
      setLoading(null);
    }
  }

  async function handleReExtract() {
    setLoading("reextract");
    setFeedback(null);
    try {
      const result = await reExtractInvoice(invoice.id);
      if (!result.success) throw new Error(result.error);
      setFeedback({ type: "success", message: t.feedback.reExtracted });
      onActionComplete?.();
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : t.feedback.reExtractionFailed,
      });
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) return;
    setLoading("reject");
    setFeedback(null);
    try {
      await rejectInvoice(invoice.id, rejectReason);
      setFeedback({ type: "success", message: t.feedback.rejected });
      setShowRejectDialog(false);
      onActionComplete?.();
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : t.feedback.rejectionFailed,
      });
    } finally {
      setLoading(null);
    }
  }

  async function handleSplit() {
    setLoading("split");
    setFeedback(null);
    try {
      const result = await splitPendingInvoice(invoice.id);
      if (!result.success) throw new Error(result.error);
      const bits = [
        t.feedback.splitCreated.replace(
          "{count}",
          result.invoiceIds.length.toString()
        ),
      ];
      if (result.duplicates > 0) {
        bits.push(
          t.feedback.splitDuplicatesSkipped.replace(
            "{count}",
            result.duplicates.toString()
          )
        );
      }
      if (result.warnings > 0) {
        bits.push(
          t.feedback.splitWarnings.replace(
            "{count}",
            result.warnings.toString()
          )
        );
      }
      if (result.errors.length > 0) {
        bits.push(
          t.feedback.splitErrors.replace(
            "{count}",
            result.errors.length.toString()
          )
        );
      }
      setFeedback({ type: "success", message: bits.join("; ") });
      setShowSplitDialog(false);
      // Original invoice row is hard-deleted server-side, so treat this
      // card as removed from the queue.
      onInvoiceDeleted?.();
      onActionComplete?.();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t.feedback.splitFailed,
      });
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
      <Card
        id={`pending-invoice-${invoice.id}`}
        className="scroll-mt-24 overflow-hidden rounded-xl"
      >
        <CardHeader className="pb-3">
          {/* Mobile-first stack: title on top, badges + actions wrap below.
              From `sm` up the two halves sit on one row with the actions
              right-aligned. The previous single-row `justify-between`
              layout overflowed off-card on phones (badges drifted across
              the title). */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {onSelectChange && (
                <Checkbox
                  className="shrink-0"
                  checked={selected}
                  onCheckedChange={(checked) =>
                    onSelectChange?.(checked === true)
                  }
                />
              )}
              <CardTitle
                className={`min-w-0 break-words text-base ${needsVendorResolution ? "text-red-600" : ""}`}
              >
                {invoice.vendorId ? (
                  <Link
                    href={`/vendors/${invoice.vendorId}`}
                    className="hover:underline"
                  >
                    {invoice.vendorName ??
                      invoice.suggestedVendorName ??
                      t.unknownVendor}
                  </Link>
                ) : (
                  <>
                    {invoice.vendorName ??
                      invoice.suggestedVendorName ??
                      t.unknownVendor}
                  </>
                )}
                {invoice.invoiceNumber && (
                  <span className="ms-2 text-sm font-normal text-muted-foreground">
                    #{invoice.invoiceNumber}
                  </span>
                )}
              </CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Badge
                variant="outline"
                className={confidenceColor(confidence)}
              >
                {confidenceLabel(confidence, t.confidence)} ({(confidence * 100).toFixed(0)}%)
              </Badge>
              {invoice.extractionMethod && (
                <Badge variant="outline" className="text-xs">
                  {invoice.extractionMethod}
                </Badge>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setShowProblemDialog(true)}
                title={t.actions.reportProblem}
                aria-label={t.actions.reportProblem}
              >
                <AlertCircle className="h-3.5 w-3.5 sm:me-1" />
                {/* Hide the verbose label on phones — the tappable area is
                    still ~28px high and the icon + tooltip carry intent. */}
                <span className="hidden sm:inline">
                  {t.actions.reportProblem}
                </span>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left: File Preview */}
            <div className="min-h-[400px] overflow-hidden rounded-md border bg-muted/30">
              <InvoicePreviewFrame
                previewSrc={previewSrc}
                className="h-full min-h-[400px] w-full border-0"
                title={`Preview: ${invoice.fileName ?? "Invoice"}`}
              />
            </div>

            {/* Right: Editable Form */}
            <form
              onSubmit={handleSubmit(handleSave)}
              className="space-y-4"
            >
              {needsVendorResolution && invoice.suggestedVendorName && (
                <VendorResolutionPanel
                  invoiceId={invoice.id}
                  suggestedVendorName={invoice.suggestedVendorName}
                  vendors={vendors}
                  onResolved={({ vendorId, vendorName }) => {
                    // Sync the form's Vendor input with the resolved name.
                    // Otherwise a later Save/Approve would still POST the
                    // stale suggested name and the server would re-link the
                    // invoice to the garbage guess, undoing the resolution.
                    setValue("vendorName", vendorName);
                    // Auto-sync type based on the resolved vendor's income flag
                    const resolved = vendors.find((v) => v.id === vendorId);
                    if (resolved) {
                      setValue("type", resolved.isIncomeSource ? "income" : "expense");
                    }
                    onActionComplete?.();
                  }}
                />
              )}

              {canOverrideVendor && showVendorOverride && (
                <VendorResolutionPanel
                  invoiceId={invoice.id}
                  currentVendor={{
                    id: invoice.vendorId!,
                    name: invoice.vendorName ?? "(unnamed)",
                  }}
                  vendors={vendors}
                  onResolved={({ vendorId, vendorName }) => {
                    setValue("vendorName", vendorName);
                    // Auto-sync type based on the new vendor's income flag
                    const resolved = vendors.find((v) => v.id === vendorId);
                    if (resolved) {
                      setValue("type", resolved.isIncomeSource ? "income" : "expense");
                    }
                    setShowVendorOverride(false);
                    onActionComplete?.();
                  }}
                />
              )}

              {/* Mobile: 1 col / Desktop: 2 cols. Prevents the date+vendor
                  pair from squeezing under ~150px each on a 360px phone. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`date-${invoice.id}`}>{t.fields.invoiceDate}</Label>
                  <Input
                    id={`date-${invoice.id}`}
                    type="text"
                    inputMode="numeric"
                    placeholder="yyyy/mm/dd"
                    pattern="\d{4}/\d{2}/\d{2}"
                    {...register("invoiceDate")}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`vendor-${invoice.id}`}>{t.fields.vendor}</Label>
                    {canOverrideVendor && (
                      <button
                        type="button"
                        className="shrink-0 text-xs text-blue-600 hover:underline"
                        onClick={() => setShowVendorOverride((v) => !v)}
                      >
                        {showVendorOverride ? t.actions.hideOptions : t.actions.changeVendor}
                      </button>
                    )}
                  </div>
                  <Input
                    id={`vendor-${invoice.id}`}
                    {...register("vendorName")}
                    disabled={needsVendorResolution}
                    className={
                      needsVendorResolution
                        ? "opacity-60"
                        : undefined
                    }
                  />
                </div>
              </div>

              {/* Mobile: 2 cols with VAT spanning both on row 2; Desktop:
                  3 cols. Currency stays beside Amount (most common pair to
                  glance at) and VAT gets full width below to fit the
                  numeric input + thumb. */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`amount-${invoice.id}`}>{t.fields.amount}</Label>
                  <Input
                    id={`amount-${invoice.id}`}
                    type="number"
                    step="0.01"
                    {...register("amount")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t.fields.currency}</Label>
                  <Select
                    value={currencyValue}
                    onValueChange={(v) => setValue("currency", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ILS">ILS</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5 sm:col-span-1">
                  <Label htmlFor={`vat-${invoice.id}`}>{t.fields.vatAmount}</Label>
                  <Input
                    id={`vat-${invoice.id}`}
                    type="number"
                    step="0.01"
                    {...register("vatAmount")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`invnum-${invoice.id}`}>{t.fields.invoiceNumber}</Label>
                  <Input
                    id={`invnum-${invoice.id}`}
                    {...register("invoiceNumber")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t.fields.type}</Label>
                  <Select
                    value={typeValue}
                    onValueChange={(v) => setValue("type", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">{t.type.expense}</SelectItem>
                      <SelectItem value="income">{t.type.income}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`desc-${invoice.id}`}>{t.fields.description}</Label>
                <Textarea
                  id={`desc-${invoice.id}`}
                  rows={2}
                  {...register("description")}
                />
              </div>

              {feedback && (
                <div
                  className={`rounded-md p-2 text-sm ${
                    feedback.type === "success"
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {feedback.message}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={loading !== null || needsVendorResolution}
                >
                  {loading === "save" ? (
                    <Loader2 className="me-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="me-1 h-4 w-4" />
                  )}
                  {t.actions.save}
                </Button>

                <Button
                  type="button"
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  disabled={loading !== null || needsVendorResolution}
                  onClick={handleApprove}
                >
                  {loading === "approve" ? (
                    <Loader2 className="me-1 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="me-1 h-4 w-4" />
                  )}
                  {t.actions.approve}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading !== null || !invoice.fileUrl?.trim()}
                  onClick={handleReExtract}
                  title={t.actions.regenerateTitle}
                >
                  {loading === "reextract" ? (
                    <Loader2 className="me-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="me-1 h-4 w-4" />
                  )}
                  {t.actions.regenerate}
                </Button>
                {canSplit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading !== null}
                    onClick={() => setShowSplitDialog(true)}
                    title={t.actions.splitTitle}
                  >
                    {loading === "split" ? (
                      <Loader2 className="me-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Scissors className="me-1 h-4 w-4" />
                    )}
                    {t.actions.split}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={loading !== null}
                  onClick={() => setShowRejectDialog(true)}
                >
                  <XCircle className="me-1 h-4 w-4" />
                  {t.actions.reject}
                </Button>
                <DeleteInvoiceButton
                  invoiceId={invoice.id}
                  label={
                    invoice.invoiceNumber?.trim() ||
                    invoice.vendorName ||
                    invoice.suggestedVendorName ||
                    t.unknownVendor
                  }
                  variant="compact"
                  onDeleted={onInvoiceDeleted}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t.helper.approve}
              </p>
            </form>
          </div>
        </CardContent>
      </Card>

      {/* Split Dialog */}
      <Dialog open={showSplitDialog} onOpenChange={setShowSplitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.splitDialog.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              {invoice.pageCount != null
                ? t.splitDialog.bodyPages.replace(
                    "{pageCount}",
                    invoice.pageCount.toString()
                  )
                : t.splitDialog.bodyMultiPage}
            </p>
            <p>{t.splitDialog.warning}</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSplitDialog(false)}
              disabled={loading === "split"}
            >
              {t.splitDialog.cancel}
            </Button>
            <Button onClick={handleSplit} disabled={loading === "split"}>
              {loading === "split" ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Scissors className="me-1 h-4 w-4" />
              )}
              {t.splitDialog.splitWithAi}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.rejectDialog.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="reject-reason">{t.rejectDialog.reasonLabel}</Label>
            <Textarea
              id="reject-reason"
              placeholder={t.rejectDialog.reasonPlaceholder}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRejectDialog(false)}
            >
              {t.rejectDialog.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim() || loading === "reject"}
            >
              {loading === "reject" && (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              )}
              {t.rejectDialog.reject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProblemReportModal
        invoice={invoice}
        open={showProblemDialog}
        onOpenChange={setShowProblemDialog}
      />
    </>
  );
}
