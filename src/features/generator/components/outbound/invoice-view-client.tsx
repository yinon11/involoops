"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TemplatePreview } from "@/features/generator/components/templates/template-preview";
import {
  updateOutboundInvoiceStatus,
  updateOutboundInvoiceDraft,
  deleteOutboundInvoice,
  cancelAfterShaamRejection,
  cancelAfterVoluntaryAllocationDecline,
  issueOutboundInvoice,
  sendOutboundInvoiceByEmail,
} from "@/features/generator/actions/outbound-invoice-actions";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";
import { displayDocumentNumber } from "@/lib/documents/display-number";
import { canCancelWithoutCreditNote } from "@/lib/documents/cancellation";
import type { DocumentType } from "@/lib/documents/types";
import type { OutboundInvoiceStatus } from "@/db/schema/outbound-invoices";
import type { TemplateConfig, InvoiceData } from "@/types/template";
import { DocumentStatusChip, type ShaamStatus } from "@/features/generator/components/outbound/document-status-chip";
import {
  IssueConfirmationModal,
  type ItaAuthorizationGate,
} from "@/features/generator/components/outbound/issue-confirmation-modal";
import { SendInvoiceModal } from "@/features/generator/components/outbound/send-invoice-modal";
import { PostIssueSendPrompt } from "@/features/generator/components/outbound/post-issue-send-prompt";
import {
  ArrowLeft,
  Download,
  Trash2,
  Loader2,
  ShieldCheck,
  FileSignature,
  FileMinus,
  Ban,
  Receipt,
  Send,
} from "lucide-react";

interface InvoiceViewClientProps {
  invoiceId: string;
  config: TemplateConfig;
  invoice: InvoiceData;
  status: OutboundInvoiceStatus;
  documentType: DocumentType;
  formattedNumber: string;
  signature: {
    signedAt: Date;
    keyId: string;
    canonicalJsonHashShort: string;
    verifyUrl: string;
    qrDataUrl: string;
  } | null;
  /** When true, show the "Issue Credit Note" action (Spec 06). */
  canIssueCredit?: boolean;
  /**
   * When true, show "Issue Receipt for this invoice" — only for issued
   * tax invoices that still carry an outstanding balance. The button
   * routes to /outbound/new?type=RECEIPT&forInvoiceId={id}; the new
   * receipt's issue flow flips this invoice to `paid` once the running
   * balance clears.
   */
  canIssueReceipt?: boolean;
  /**
   * When true, show "Convert to Tax Invoice" — surfaced on issued
   * PROFORMA / DELIVERY_NOTE rows that haven't been converted yet.
   * Routes to /outbound/new?fromSourceId={id}; the page server-side
   * loads the source and pre-fills the new TI form with its items,
   * customer, and currency.
   */
  canConvertToInvoice?: boolean;
  /** Current SHAAM status for the unified chip (if the document has one). */
  shaamStatus?: ShaamStatus;
  /**
   * Enough of the last Tax Authority answer to reopen the refusal options
   * after the dialog has been closed.
   */
  shaamReview?: {
    allocationNumber: string | null;
    submittedAt: string | null;
    respondedAt: string | null;
    retryCount: number;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    hearingDeadline: string | null;
    canRemediate: boolean;
    customerCanReverseCharge: boolean;
    nowMs: number;
    holdChecksStopped?: boolean;
  } | null;
  /** Spec 11 §4 — wired into the issue confirmation modal. */
  itaGate?: ItaAuthorizationGate;
  /** Set when the draft date is not the Israel civil day. */
  dateChangeNotice?: string | null;
  /** See `IssueConfirmationModal`. */
  customerTaxIdBlock?: { customerHref: string | null } | null;
  /**
   * The draft's reverse-charge switch is on. It is then a reverse-charge
   * invoice, issued from the reverse-charge card's own step once the buyer
   * signs — the header offers no second, ordinary issue button.
   */
  reverseChargeOn?: boolean;
  /**
   * The draft already holds a fiscal number (an issue the Tax Authority
   * refused or never answered). It cannot be discarded — that would leave
   * a gap in the numbering — only issued or cancelled after the refusal.
   */
  hasNumber?: boolean;
  /** The reverse-charge card (switch + steps), for document types that allow it. */
  reverseChargePanel?: ReactNode;
  /**
   * Attached customer, when present. Drives the post-issue "Send to
   * customer?" prompt and the per-customer delivery-preference card.
   */
  customer?: {
    id: string;
    name: string;
    email: string | null;
    autoSendInvoices: boolean | null;
  } | null;
  /**
   * A draft whose optional allocation request was refused, and which the
   * seller has not yet issued or cancelled. Reopens the same choice.
   */
  voluntaryDeclinePending?: {
    code: string | null;
    message: string | null;
  } | null;
  withholdingCertificate?: {
    filename: string | null;
    attachByDefault: boolean;
    expired: boolean;
  } | null;
}

import {
  requestShaamHearing,
} from "@/features/generator/actions/shaam-invoice-actions";
import { classifyShaamRejection } from "@/lib/shaam/rejection-options";
import { ShaamStatusPanel } from "./shaam-status-panel";
import { switchOnReverseCharge } from "@/features/generator/actions/reverse-charge-consent-actions";
import { DocumentIssueContext } from "./document-issue-context";
import {
  ShaamRejectionDialog,
  type ShaamRejectionDetails,
} from "./shaam-rejection-dialog";

const POST_ISSUE_STATUSES: OutboundInvoiceStatus[] = [
  "issued",
  "sent",
  "paid",
  "voided",
];

export function InvoiceViewClient({
  invoiceId,
  config,
  invoice,
  status: initialStatus,
  documentType,
  formattedNumber,
  signature,
  canIssueCredit = false,
  canIssueReceipt = false,
  canConvertToInvoice = false,
  shaamStatus,
  shaamReview = null,
  itaGate,
  customerTaxIdBlock = null,
  reverseChargeOn = false,
  reverseChargePanel = null,
  hasNumber = false,
  dateChangeNotice = null,
  customer = null,
  withholdingCertificate = null,
  voluntaryDeclinePending = null,
}: InvoiceViewClientProps) {
  const router = useRouter();
  const { dict } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<OutboundInvoiceStatus>(initialStatus);
  const shownNumber = displayDocumentNumber({
    id: invoiceId,
    status,
    formattedNumber,
  });
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [rejectionOpen, setRejectionOpen] = useState(false);
  const [reviewNonce, setReviewNonce] = useState(0);
  const [rejectionDetails, setRejectionDetails] =
    useState<ShaamRejectionDetails | null>(null);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [voluntaryDecline, setVoluntaryDecline] = useState<{
    code: string | null;
    message: string | null;
  } | null>(voluntaryDeclinePending);
  const [declineIssuing, setDeclineIssuing] = useState(false);
  const [postIssuePromptOpen, setPostIssuePromptOpen] = useState(false);
  const [autoSendPreference] = useState<
    boolean | null
  >(customer?.autoSendInvoices ?? null);
  const [previewInvoice, setPreviewInvoice] = useState(invoice);
  const [languageSaving, setLanguageSaving] = useState(false);
  // The refusal card hides the reverse-charge panel until that option is
  // chosen. The panel mounts only after the refresh that follows, so the
  // scroll waits for that render.
  const scrollToReverseCharge = useRef(false);

  useEffect(() => {
    setPreviewInvoice(invoice);
  }, [invoice]);

  useEffect(() => {
    if (!reverseChargeOn || !scrollToReverseCharge.current) return;
    scrollToReverseCharge.current = false;
    document
      .getElementById("reverse-charge-panel")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [reverseChargeOn]);

  async function handleLanguageChange(next: string) {
    if (next !== "he" && next !== "en") return;
    const prev = previewInvoice.language;
    setPreviewInvoice((inv) => ({ ...inv, language: next }));
    setLanguageSaving(true);
    try {
      await updateOutboundInvoiceDraft(invoiceId, { language: next });
      router.refresh();
    } catch (err) {
      setPreviewInvoice((inv) => ({ ...inv, language: prev }));
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLanguageSaving(false);
    }
  }

  function handleCancelDocument() {
    setCancelOpen(false);
    setIssueError(null);
    startTransition(async () => {
      try {
        await updateOutboundInvoiceStatus(invoiceId, "voided");
        setStatus("voided");
        router.refresh();
      } catch (err) {
        setIssueError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function handleDownloadPdf() {
    setIsGeneratingPdf(true);
    try {
      const res = await fetch(`/api/invoice-pdf?id=${invoiceId}`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${shownNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setPreviewInvoice((inv) =>
        inv.copyMarker === "original" ? { ...inv, copyMarker: "copy" } : inv,
      );
      router.refresh();
    } catch {
      alert("Failed to generate PDF. Please try again.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  function handleDelete() {
    toast(dict.outbound.detail.discardConfirm, {
      action: {
        label: dict.outbound.detail.discardDraft,
        onClick: () => {
          startTransition(async () => {
            try {
              await deleteOutboundInvoice(invoiceId);
              router.push("/outbound");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
            }
          });
        },
      },
      cancel: { label: dict.common.cancel, onClick: () => {} },
    });
  }

  function buildDefaultSubject(): string {
    return dict.outbound.sendModal.defaultSubject
      .replace("{number}", formattedNumber)
      .replace("{business}", config.businessName ?? "");
  }

  function buildDefaultBody(): string {
    return dict.outbound.sendModal.defaultBody
      .replace("{customer}", invoice.customerName ?? "")
      .replace("{number}", formattedNumber)
      .replace("{business}", config.businessName ?? "");
  }

  /**
   * One issue attempt. Called first without options; if the ITA refuses,
   * the rejection dialog calls it again with the seller's choice.
   */
  // Issuing a 0% non-reverse-charge tax invoice needs the server told it
  // is deliberate; the confirmation modal shows the warning for exactly
  // this condition, so confirming it IS the acknowledgement.
  const zeroVatNotice =
    (documentType === "TAX_INVOICE" ||
      documentType === "TAX_INVOICE_RECEIPT") &&
    invoice.vatAmount === 0 &&
    !invoice.reverseCharge;

  async function runIssue(options?: {
    onRejection?: "issue_without_allocation";
    requestAllocationAnyway?: boolean;
    confirmIssueWithoutAllocation?: boolean;
  }) {
    const result = await issueOutboundInvoice(invoiceId, {
      ...options,
      ...(zeroVatNotice ? { confirmZeroVat: true } : {}),
    });
    if (!result.success) {
      // A refusal is a decision to make, not an error to read. Hand it to
      // the dialog instead of dumping the ITA's raw string on the page.
      if (result.shaamRejection && result.shaamRejectionOptions?.length) {
        setRejectionDetails({
          status: result.shaamRejection,
          errorCode: result.shaamErrorCode ?? null,
          errorMessage: result.error,
          reasonKey: result.shaamRejectionReasonKey ?? null,
          kind: result.shaamRejectionKind ?? "unknown",
          options: result.shaamRejectionOptions,
          formattedNumber,
          hearingDeadline: result.shaamHearingDeadline ?? null,
          nowMs: Date.now(),
        });
        setIssueModalOpen(false);
        setRejectionOpen(true);
        return;
      }
      if (result.voluntaryAllocationDeclined) {
        setVoluntaryDecline({
          code: result.shaamErrorCode ?? null,
          message: result.error,
        });
        setIssueModalOpen(false);
        return;
      }
      setIssueError(
        result.documentsLocked
          ? dict.outbound.issuanceLockedBody
          : result.customerTaxIdRequired
            ? dict.outbound.issueModal.customerTaxIdBlockedBody
            : result.reverseChargeRefusedByIta
              ? dict.reverseCharge.refusedByIta
              : result.reverseChargePendingSignature
                ? dict.reverseCharge.issuePendingSignature
                : result.reverseChargeBlocked
                  ? dict.reverseCharge.issueBlocked
                  : result.error,
      );
      if (result.documentsLocked) setIssueModalOpen(false);
      // Route B: a replacement draft may now exist; the panel links to it.
      if (result.replacementInvoiceId) router.refresh();
      return;
    }
    // Route B: the refused invoice was not issued — a new zero-VAT invoice
    // replaced it, and that is the one to show (and send) now.
    if (result.replacementInvoiceId) {
      setRejectionOpen(false);
      setIssueModalOpen(false);
      toast.success(
        format(dict.reverseCharge.replacementIssued, {
          number: result.formattedNumber,
        }),
      );
      router.push(`/outbound/${result.replacementInvoiceId}`);
      return;
    }
    setRejectionOpen(false);
    setVoluntaryDecline(null);
    setStatus("issued");
    setIssueModalOpen(false);

    const customerEmail = customer?.email?.trim() ?? "";
    const canSend = Boolean(customer && customerEmail);

    if (canSend && autoSendPreference === true) {
      const sendResult = await sendOutboundInvoiceByEmail({
        invoiceId,
        to: customerEmail,
        subject: buildDefaultSubject(),
        body: buildDefaultBody(),
        attachWithholdingCertificate: Boolean(
          withholdingCertificate?.attachByDefault,
        ),
      });
      if (sendResult.success) {
        setStatus(sendResult.newStatus);
        toast.success(
          dict.outbound.sendModal.sentSuccess.replace(
            "{email}",
            customerEmail,
          ),
        );
      } else {
        toast.error(sendResult.error);
      }
      router.refresh();
      return;
    }

    if (canSend && autoSendPreference === null) {
      setPostIssuePromptOpen(true);
      return;
    }

    // No customer, no email, or explicit "never auto-send".
    router.refresh();
  }

  function handleIssue(choice?: { requestAllocationAnyway?: boolean }) {
    setIssueError(null);
    startTransition(() => runIssue(choice));
  }

  async function handleCancelVoluntaryDecline() {
    const result = await cancelAfterVoluntaryAllocationDecline(invoiceId);
    if (!result.success) {
      setIssueError(result.error);
      return;
    }
    setVoluntaryDecline(null);
    setStatus("voided");
    router.refresh();
  }

  async function handleCancelAfterRejection() {
    const result = await cancelAfterShaamRejection(invoiceId);
    if (!result.success) {
      setIssueError(result.error);
      return;
    }
    setRejectionOpen(false);
    setStatus("voided");
    router.refresh();
  }

  function openRejectionOptions() {
    if (
      !shaamReview ||
      (shaamStatus !== "REJECTED" && shaamStatus !== "HELD")
    ) {
      return;
    }
    const classification = classifyShaamRejection({
      errorCode: shaamReview.lastErrorCode,
      customerIsOsekMurshe: shaamReview.customerCanReverseCharge,
    });
    setRejectionDetails({
      status: shaamStatus,
      errorCode: shaamReview.lastErrorCode,
      errorMessage:
        shaamReview.lastErrorMessage ??
        (shaamStatus === "HELD"
          ? "SHAAM held the invoice for manual review."
          : "SHAAM rejected the invoice."),
      reasonKey: classification.reasonKey,
      kind: classification.kind,
      options: classification.options,
      formattedNumber,
      hearingDeadline: shaamReview.hearingDeadline,
      nowMs: shaamReview.nowMs,
    });
    setReviewNonce((n) => n + 1);
    setRejectionOpen(true);
  }

  async function handleRequestHearing(): Promise<
    { ok: true } | { ok: false; error: string }
  > {
    const result = await requestShaamHearing(invoiceId);
    if (!result.ok) return result;
    router.refresh();
    return { ok: true };
  }

  // Reverse charge after a refusal: the option turns the reverse-charge
  // switch on, and the card's two steps take it from there — the buyer
  // signs, then the seller issues. Nothing is sent to the Tax Authority
  // from here: the action-3 request goes out on that issue.
  async function handleOfferReverseCharge() {
    scrollToReverseCharge.current = true;
    const result = await switchOnReverseCharge(invoiceId);
    setRejectionOpen(false);
    if (!result.ok) {
      scrollToReverseCharge.current = false;
      setIssueError(result.error);
      return;
    }
    router.refresh();
  }

  const isDraft = status === "draft";
  const isPostIssue = POST_ISSUE_STATUSES.includes(status);
  const cancelWithoutCredit =
    canCancelWithoutCreditNote(documentType) && !isDraft && status !== "voided";
  const documentTypeLabel = dict.documents.type[documentType];

  return (
    <div className="space-y-6">
      {shaamStatus &&
        shaamReview &&
        // "Not required" is the outcome of the amount check, not a filing.
        // After issue there is nothing for the seller to do with it, so the
        // card — including "request an allocation number anyway" — stays off
        // the page. A real allocation outcome (approved, pending, refused)
        // still shows.
        shaamStatus !== "NOT_REQUIRED" && (
        <ShaamStatusPanel
          documentId={invoiceId}
          status={shaamStatus}
          allocationNumber={shaamReview.allocationNumber}
          submittedAt={shaamReview.submittedAt}
          respondedAt={shaamReview.respondedAt}
          retryCount={shaamReview.retryCount}
          lastErrorCode={shaamReview.lastErrorCode}
          lastErrorMessage={shaamReview.lastErrorMessage}
          hearingDeadline={shaamReview.hearingDeadline}
          canRemediate={shaamReview.canRemediate}
          nowMs={shaamReview.nowMs}
          holdChecksStopped={shaamReview.holdChecksStopped}
          onReviewOptions={
            shaamStatus === "REJECTED" || shaamStatus === "HELD"
              ? openRejectionOptions
              : undefined
          }
        />
      )}
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/outbound">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <h1 className="font-mono text-xl font-bold">{shownNumber}</h1>
          <Badge variant="secondary" className="bg-indigo-50 text-indigo-700">
            {dict.documents.type[documentType]}
          </Badge>
          <span data-voice-status={status} data-highlight="doc-status">
            <DocumentStatusChip
              status={status}
              shaamStatus={shaamStatus}
              dict={dict}
            />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDraft && !reverseChargeOn && (
            <Button
              onClick={() => setIssueModalOpen(true)}
              disabled={isPending}
              className="gap-2"
              data-voice-action="issue-document"
              data-highlight="doc-issue"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSignature className="h-4 w-4" />
              )}
              {format(dict.outbound.action.issueByType, {
                type: dict.documents.type[documentType],
              })}
            </Button>
          )}
          {!isDraft && status !== "voided" && (
            <Button
              onClick={() => setSendModalOpen(true)}
              disabled={isPending}
              variant={status === "issued" ? "default" : "outline"}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {status === "issued"
                ? dict.outbound.action.send
                : dict.outbound.action.resend}
            </Button>
          )}
          <Button
            onClick={handleDownloadPdf}
            disabled={isGeneratingPdf}
            className="gap-2"
            variant={isPostIssue ? "default" : "outline"}
          >
            {isGeneratingPdf ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" /> Download PDF
              </>
            )}
          </Button>
          {canIssueReceipt && (
            <Link
              href={`/outbound/new?type=RECEIPT&forInvoiceId=${invoiceId}`}
            >
              <Button
                variant="outline"
                className="gap-2 border-emerald-300 text-emerald-800 hover:bg-emerald-50"
              >
                <Receipt className="h-4 w-4" />
                {dict.outbound.receiptForInvoice.action}
              </Button>
            </Link>
          )}
          {canConvertToInvoice && (
            <Link href={`/outbound/new?fromSourceId=${invoiceId}`}>
              <Button
                variant="outline"
                className="gap-2 border-indigo-300 text-indigo-800 hover:bg-indigo-50"
              >
                <FileSignature className="h-4 w-4" />
                {dict.outbound.sourceConversion.action}
              </Button>
            </Link>
          )}
          {canIssueCredit && (
            <Link href={`/outbound/${invoiceId}/credit`}>
              <Button variant="outline" className="gap-2 border-red-300 text-red-700 hover:bg-red-50">
                <FileMinus className="h-4 w-4" />
                {dict.outbound.creditNote.action}
              </Button>
            </Link>
          )}
          {cancelWithoutCredit && (
            <Button
              variant="outline"
              onClick={() => setCancelOpen(true)}
              disabled={isPending}
              className="gap-2 border-red-300 text-red-700 hover:bg-red-50"
            >
              <Ban className="h-4 w-4" />
              {format(dict.outbound.action.cancelDocument, {
                type: documentTypeLabel,
              })}
            </Button>
          )}
          {isDraft && !hasNumber && (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={isPending}
              className="gap-2 border-red-300 text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              {dict.outbound.detail.discardDraft}
            </Button>
          )}
        </div>
      </div>

      {issueError && <p className="text-sm text-red-600">{issueError}</p>}

      {reverseChargePanel && (
        <DocumentIssueContext.Provider
          value={{ openIssue: () => setIssueModalOpen(true), issuing: isPending }}
        >
          {reverseChargePanel}
        </DocumentIssueContext.Provider>
      )}

      {signature && (
        <div className="flex flex-wrap items-start gap-4 rounded-md border bg-green-50 px-4 py-3 text-sm text-green-900">
          <ShieldCheck className="h-5 w-5 shrink-0" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="font-medium">{dict.outbound.signature.verified}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-green-800/80">
              <span>
                {dict.outbound.signature.signedAt}:{" "}
                <span className="font-mono break-all">
                  {signature.signedAt
                    .toISOString()
                    .replace("T", " ")
                    .slice(0, 19)}
                  {" UTC"}
                </span>
              </span>
              <span>
                {dict.outbound.signature.keyId}:{" "}
                <span className="font-mono break-all">{signature.keyId}</span>
              </span>
              <span className="font-mono break-all">
                {signature.canonicalJsonHashShort}…
              </span>
            </div>
          </div>
        </div>
      )}

      {isDraft && (
        <div className="mx-auto flex max-w-3xl flex-wrap items-end gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <div className="space-y-1">
            <Label className="text-xs">
              {dict.outbound.createForm.languageLabel}
            </Label>
            <Select
              value={previewInvoice.language === "he" ? "he" : "en"}
              onValueChange={handleLanguageChange}
              disabled={languageSaving || isPending}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="he">עברית</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {dict.outbound.detail.languageHint}
          </p>
        </div>
      )}

      {/* Invoice preview */}
      <div className="mx-auto max-w-3xl">
        <TemplatePreview
          config={config}
          invoice={previewInvoice}
          signature={signature}
          watermark={
            status === "voided" ? "voided" : status === "draft" ? "draft" : null
          }
        />
      </div>

      <IssueConfirmationModal
        open={issueModalOpen}
        onOpenChange={setIssueModalOpen}
        onConfirm={handleIssue}
        isPending={isPending}
        itaGate={itaGate ?? { required: false }}
        documentType={documentType}
        dateChangeNotice={dateChangeNotice}
        customerTaxIdBlock={customerTaxIdBlock}
        zeroVatNotice={zeroVatNotice}
      />

      <ShaamRejectionDialog
        key={reviewNonce}
        open={rejectionOpen}
        onOpenChange={setRejectionOpen}
        details={rejectionDetails}
        onIssueWithoutAllocation={() =>
          runIssue({ onRejection: "issue_without_allocation" })
        }
        onCancelInvoice={handleCancelAfterRejection}
        onFixAndRetry={() => setIssueModalOpen(false)}
        onOfferReverseCharge={handleOfferReverseCharge}
        onRequestHearing={handleRequestHearing}
      />

      <Dialog
        open={voluntaryDecline != null}
        onOpenChange={(open) => {
          if (!open && !isPending && !declineIssuing) setVoluntaryDecline(null);
        }}
      >
        <DialogContent
          onPointerDownOutside={(event) => {
            if (declineIssuing || isPending) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (declineIssuing || isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {declineIssuing
                ? dict.outbound.issueModal.voluntaryDeclineWorking
                : dict.outbound.issueModal.voluntaryDeclineTitle}
            </DialogTitle>
            {!declineIssuing && (
              <DialogDescription>
                {dict.outbound.issueModal.voluntaryDeclineBody}
              </DialogDescription>
            )}
          </DialogHeader>
          {!declineIssuing && voluntaryDecline && (voluntaryDecline.code || voluntaryDecline.message) ? (
            <p className="font-mono text-xs text-gray-600">
              {format(dict.outbound.issueModal.voluntaryDeclineDetail, {
                detail: [voluntaryDecline.code, voluntaryDecline.message]
                  .filter(Boolean)
                  .join(" — "),
              })}
            </p>
          ) : null}
          {!declineIssuing && issueError ? (
            <p className="text-sm text-red-600">{issueError}</p>
          ) : null}
          {declineIssuing ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => {
                startTransition(() => handleCancelVoluntaryDecline());
              }}
            >
              {dict.outbound.issueModal.voluntaryDeclineNo}
            </Button>
            <Button
              disabled={isPending}
              onClick={() => {
                setIssueError(null);
                setDeclineIssuing(true);
                startTransition(async () => {
                  try {
                    await runIssue({ confirmIssueWithoutAllocation: true });
                  } finally {
                    setDeclineIssuing(false);
                  }
                });
              }}
            >
              {dict.outbound.issueModal.voluntaryDeclineYes}
            </Button>
          </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {format(dict.outbound.action.cancelDocumentConfirmTitle, {
                type: documentTypeLabel,
              })}
            </DialogTitle>
            <DialogDescription>
              {dict.outbound.action.cancelDocumentConfirmBody}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              {dict.outbound.action.cancelDocumentDismiss}
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelDocument}
              disabled={isPending}
            >
              {format(dict.outbound.action.cancelDocument, {
                type: documentTypeLabel,
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SendInvoiceModal
        open={sendModalOpen}
        onOpenChange={setSendModalOpen}
        invoiceId={invoiceId}
        formattedNumber={formattedNumber}
        defaultTo={invoice.customerEmail ?? ""}
        defaultSubject={buildDefaultSubject()}
        defaultBody={buildDefaultBody()}
        shaamStatus={shaamStatus}
        withholdingCertificate={withholdingCertificate}
        onSent={() => {
          if (status === "issued") setStatus("sent");
          setPreviewInvoice((inv) =>
            inv.copyMarker === "original" ? { ...inv, copyMarker: "copy" } : inv,
          );
          router.refresh();
        }}
      />

      {customer && (
        <PostIssueSendPrompt
          open={postIssuePromptOpen}
          onOpenChange={setPostIssuePromptOpen}
          invoiceId={invoiceId}
          formattedNumber={formattedNumber}
          customerId={customer.id}
          customerName={customer.name}
          customerEmail={customer.email?.trim() ?? ""}
          defaultSubject={buildDefaultSubject()}
          defaultBody={buildDefaultBody()}
          attachWithholdingCertificate={Boolean(
            withholdingCertificate?.attachByDefault,
          )}
          onSent={(result) => {
            if (result.success) setStatus(result.newStatus);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
