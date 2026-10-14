"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ReviewCard, type PendingInvoice } from "./review-card";
import { bulkApprove } from "@/features/expenses/actions/invoice-actions";
import { updateVendor } from "@/features/expenses/actions/vendor-actions";
import { updateAutoApprovePromptPreferenceAction } from "@/actions/user-preferences-actions";
import {
  regeneratePendingInvoices,
  type RegeneratePendingFilters,
} from "@/actions/upload-actions";
import { CheckCircle, Loader2, RefreshCw, SearchX } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePendingCount } from "@/contexts/pending-count-context";
import { PendingScrollToInvoice } from "@/features/expenses/components/pending/pending-scroll-to-invoice";
import { useI18n } from "@/lib/i18n/client";

interface ApprovalQueueProps {
  invoices: PendingInvoice[];
  vendors: {
    id: string;
    name: string;
    isIncomeSource: boolean;
    autoApprove: boolean;
  }[];
  /** From /pending?invoice= — scroll to and highlight that card */
  highlightInvoiceId?: string;
  /** Pending list was filtered (e.g. by vendor) and returned no rows */
  filteredEmpty?: boolean;
  /**
   * User-level toggle: when true, the post-approve "auto-approve from this
   * vendor?" dialog never fires, regardless of whether the invoice was
   * approved without edits.
   */
  suppressAutoApprovePrompt?: boolean;
  /**
   * When set, "Regenerate" only re-runs extraction for pending rows matching
   * this slice (all pages), not every pending invoice in the account.
   */
  regeneratePendingFilter?: RegeneratePendingFilters;
}

export function ApprovalQueue({
  invoices,
  vendors,
  highlightInvoiceId,
  filteredEmpty = false,
  suppressAutoApprovePrompt = false,
  regeneratePendingFilter,
}: ApprovalQueueProps) {
  const { dict } = useI18n();
  const t = dict.approvalQueue;
  const tPrompt = dict.reviewCard.autoApprovePrompt;
  const tPromptFeedback = dict.reviewCard.feedback;
  const router = useRouter();
  const { refresh: refreshPendingCount } = usePendingCount();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  // Auto-approve prompt state. Lives at the queue level because the cards
  // unmount on approval (revalidatePath re-renders the pending list).
  const [autoApprovePrompt, setAutoApprovePrompt] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [dontShowAutoApproveAgain, setDontShowAutoApproveAgain] =
    useState(false);
  const [autoApproveBusy, setAutoApproveBusy] = useState(false);

  const allSelected =
    invoices.length > 0 && selectedIds.size === invoices.length;
  const someSelected = selectedIds.size > 0;

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoices.map((i) => i.id)));
    }
  }

  async function handleBulkApprove() {
    setFeedback(null);
    const ids = Array.from(selectedIds);
    try {
      const result = await bulkApprove(ids);
      if (!result.success) {
        setFeedback({ type: "error", message: result.error });
        return;
      }
      let msg = t.feedback.approved.replace(
        "{count}",
        result.approved.toString()
      );
      if (result.skipped > 0) {
        msg += t.feedback.skippedLocked.replace(
          "{count}",
          result.skipped.toString()
        );
      }
      setFeedback({
        type: "success",
        message: msg,
      });
      setSelectedIds(new Set());
      void refreshPendingCount();
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : t.feedback.bulkApproveFailed,
      });
    }
  }

  async function handleRegenerateAll() {
    setFeedback(null);
    setIsRegenerating(true);
    try {
      const result = await regeneratePendingInvoices(regeneratePendingFilter);
      setFeedback({
        type: result.limitReached ? "error" : "success",
        message: result.limitReached
          ? t.feedback.regeneratedLimit.replace(
              "{count}",
              result.regenerated.toString()
            )
          : t.feedback.regenerated.replace(
              "{count}",
              result.regenerated.toString()
            ),
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : t.feedback.regenerationFailed,
      });
    } finally {
      setIsRegenerating(false);
    }
  }

  function handleActionComplete() {
    void refreshPendingCount();
    startTransition(() => {
      router.refresh();
    });
  }

  async function closeAutoApprovePrompt(enableAutoApprove: boolean) {
    if (!autoApprovePrompt) return;
    setAutoApproveBusy(true);
    try {
      if (dontShowAutoApproveAgain) {
        await updateAutoApprovePromptPreferenceAction(true);
      }
      if (enableAutoApprove) {
        await updateVendor(autoApprovePrompt.id, { autoApprove: true });
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : tPromptFeedback.autoApproveFailed,
      });
    } finally {
      setAutoApproveBusy(false);
      setAutoApprovePrompt(null);
      setDontShowAutoApproveAgain(false);
      // ReviewCard skips onActionComplete when it opens this prompt, so the
      // pending list refresh happens here — once the user has dismissed the
      // dialog and can't lose it to a redirect/unmount.
      handleActionComplete();
    }
  }

  if (invoices.length === 0) {
    if (filteredEmpty) {
      return (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed">
          <SearchX className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-medium">{t.noMatchesTitle}</p>
          <p className="text-sm text-muted-foreground">
            {t.noMatchesDescription}
          </p>
        </div>
      );
    }
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed">
        <CheckCircle className="mb-3 h-10 w-10 text-green-500" />
        <p className="text-lg font-medium">{t.allCaughtUpTitle}</p>
        <p className="text-sm text-muted-foreground">
          {t.allCaughtUpDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PendingScrollToInvoice invoiceId={highlightInvoiceId} />
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={
              allSelected
                ? true
                : someSelected && !allSelected
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={toggleSelectAll}
          />
          <span className="text-sm text-muted-foreground">
            {someSelected
              ? t.nSelected.replace("{count}", selectedIds.size.toString())
              : t.selectAll}
          </span>
        </div>

        {someSelected && (
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700"
            disabled={isPending}
            onClick={handleBulkApprove}
          >
            {isPending ? (
              <Loader2 className="me-1 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="me-1 h-4 w-4" />
            )}
            {t.approveSelected.replace("{count}", selectedIds.size.toString())}
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          disabled={isRegenerating}
          onClick={handleRegenerateAll}
        >
          {isRegenerating ? (
            <Loader2 className="me-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="me-1 h-4 w-4" />
          )}
          {regeneratePendingFilter ? t.regenerateFiltered : t.regenerateAll}
        </Button>

        {feedback && (
          // `basis-full` on phones drops the feedback to its own row so it
          // doesn't compete with the action buttons for horizontal space;
          // `ms-auto` reasserts right-alignment from `sm` upwards.
          <div
            className={`basis-full rounded-md px-3 py-1 text-sm sm:ms-auto sm:basis-auto ${
              feedback.type === "success"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {feedback.message}
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-4">
        {invoices.map((invoice) => (
          <ReviewCard
            key={invoice.id}
            invoice={invoice}
            vendors={vendors}
            suppressAutoApprovePrompt={suppressAutoApprovePrompt}
            selected={selectedIds.has(invoice.id)}
            onSelectChange={(checked) => toggleSelect(invoice.id, checked)}
            onActionComplete={handleActionComplete}
            onAutoApproveCandidate={(vendor) =>
              setAutoApprovePrompt(vendor)
            }
            onInvoiceDeleted={() => {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                next.delete(invoice.id);
                return next;
              });
              void refreshPendingCount();
            }}
          />
        ))}
      </div>

      {/* Auto-approve prompt — shown after a no-edits approval. */}
      <Dialog
        open={autoApprovePrompt !== null}
        onOpenChange={(open) => {
          if (!open && !autoApproveBusy) {
            void closeAutoApprovePrompt(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tPrompt.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              {tPrompt.body.replace(
                "{vendor}",
                autoApprovePrompt?.name ?? ""
              )}
            </p>
            <label className="flex items-center gap-2 text-muted-foreground">
              <Checkbox
                checked={dontShowAutoApproveAgain}
                onCheckedChange={(v) =>
                  setDontShowAutoApproveAgain(v === true)
                }
                disabled={autoApproveBusy}
              />
              <span>{tPrompt.dontShowAgain}</span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void closeAutoApprovePrompt(false)}
              disabled={autoApproveBusy}
            >
              {tPrompt.no}
            </Button>
            <Button
              onClick={() => void closeAutoApprovePrompt(true)}
              disabled={autoApproveBusy}
            >
              {autoApproveBusy && (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              )}
              {tPrompt.yes}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
