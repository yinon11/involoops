"use client";

/*
 * Spec 08+ — the decision the seller has to make when רשות המסים refuses
 * to allocate a number for an invoice.
 *
 * Before this dialog existed, a refusal simply failed the issue with the
 * ITA's raw error text and left the document on a blocked draft with its
 * fiscal number already spent. The law gives the seller four ways out;
 * this is where they pick one. Which options appear is decided server-side
 * by `classifyShaamRejection` — an administrative refusal, for instance,
 * deliberately does not offer "fix and try again".
 */

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";
import type { ShaamRejectionKind, ShaamRejectionOption } from "@/lib/shaam/rejection-options";
import { AlertTriangle, Info, Loader2 } from "lucide-react";

export interface ShaamRejectionDetails {
  status: "REJECTED" | "HELD";
  errorCode: string | null;
  errorMessage: string;
  /** Which answer this is. Drives the title; only a merits refusal is red. */
  kind: ShaamRejectionKind;
  /** i18n key suffix under `rejection.reason.*`, or null to show the raw message. */
  reasonKey: string | null;
  options: ShaamRejectionOption[];
  formattedNumber: string | null;
  /** מועד השימוע (ISO) when the ITA returned one. Drives the hearing copy. */
  hearingDeadline: string | null;
  /**
   * Wall clock captured when the refusal came back, not read during
   * render — same reason `ShaamStatusPanel` takes one: `Date.now()` in a
   * client component's render body is impure and React Compiler flags it.
   */
  nowMs: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  details: ShaamRejectionDetails | null;
  /** Re-runs the issue with `onRejection: "issue_without_allocation"`. */
  onIssueWithoutAllocation: () => Promise<void>;
  /** Voids the document and records the spent number. */
  onCancelInvoice: () => Promise<void>;
  /** Closes the dialog so the seller can edit the draft. */
  onFixAndRetry: () => void;
  /** Resubmits with action code 3. */
  onOfferReverseCharge: () => Promise<void>;
  /** Reports the hearing choice to the ITA. The dialog shows the result. */
  onRequestHearing: () => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function ShaamRejectionDialog({
  open,
  onOpenChange,
  details,
  onIssueWithoutAllocation,
  onCancelInvoice,
  onFixAndRetry,
  onOfferReverseCharge,
  onRequestHearing,
}: Props) {
  const { dict } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [busyOption, setBusyOption] = useState<ShaamRejectionOption | null>(
    null,
  );
  const [hearingNotice, setHearingNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<
    "issue_without_allocation" | "cancel" | null
  >(null);

  if (!details) return null;
  const t = dict.shaamSubmission.rejection;

  function run(option: ShaamRejectionOption, fn: () => Promise<void>) {
    setBusyOption(option);
    startTransition(async () => {
      try {
        await fn();
      } finally {
        setBusyOption(null);
      }
    });
  }

  function handle(option: ShaamRejectionOption) {
    switch (option) {
      case "fix_and_retry":
        onOpenChange(false);
        onFixAndRetry();
        return;
      case "issue_without_allocation":
      case "cancel":
        setConfirming(option);
        return;
      case "reverse_charge":
        run(option, onOfferReverseCharge);
        return;
      case "hearing":
        // The hearing itself happens at the ITA, but the spec requires the
        // software to report that this is the route chosen
        // (InvoiceDecisionApi/v1/FurtherObjection). The result stays in
        // this dialog — never a browser alert.
        run(option, async () => {
          setActionError(null);
          const result = await onRequestHearing();
          if (!result.ok) {
            setActionError(result.error);
            return;
          }
          setHearingNotice(t.hearingGuidance);
        });
        return;
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setHearingNotice(null);
      setActionError(null);
      setConfirming(null);
    }
    onOpenChange(next);
  }

  // Shown against the hearing option: the window is short, and whether it
  // has already closed changes what the seller should do about it.
  const hearingNote = (() => {
    if (!details.hearingDeadline) return null;
    const when = new Date(details.hearingDeadline);
    if (Number.isNaN(when.getTime())) return null;
    const date = when.toLocaleDateString();
    return when.getTime() <= details.nowMs
      ? format(dict.shaamSubmission.hearingDeadlinePassed, { date })
      : format(dict.shaamSubmission.hearingDeadline, { date });
  })();

  const reasonText = details.reasonKey
    ? (t.reason as Record<string, string | undefined>)[details.reasonKey]
    : null;
  const title =
    details.kind === "administrative"
      ? t.titleRefused
      : details.kind === "pending_decision"
        ? t.titlePending
        : details.kind === "validation"
          ? t.titleValidation
          : details.kind === "permission"
            ? t.titlePermission
            : details.kind === "our_fault"
              ? t.titleOurFault
              : t.title;
  const titleClass =
    details.kind === "administrative"
      ? "text-red-700"
      : details.kind === "pending_decision"
        ? "text-amber-800"
        : "";
  const iconClass =
    details.kind === "administrative"
      ? "text-red-600"
      : details.kind === "pending_decision"
        ? "text-amber-600"
        : "text-slate-500";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${titleClass}`}>
            {details.kind === "administrative" ||
            details.kind === "pending_decision" ? (
              <AlertTriangle className={`h-5 w-5 ${iconClass}`} />
            ) : (
              <Info className={`h-5 w-5 ${iconClass}`} />
            )}
            {title}
          </DialogTitle>
          <DialogDescription>{t.subtitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* What the ITA actually said, verbatim, plus our reading of it.
              The raw text matters: an accountant will ask for it. */}
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{t.itaSaid}</p>
            <p className="mt-1 font-mono text-xs break-words">
              {details.errorCode ? `${details.errorCode}: ` : ""}
              {details.errorMessage}
            </p>
            {reasonText && (
              <p className="mt-2 text-muted-foreground">{reasonText}</p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p>{t.vatWarning}</p>
              {details.formattedNumber && (
                <p>
                  {format(t.numberBurnt, { number: details.formattedNumber })}
                </p>
              )}
            </div>
          </div>

          {actionError && (
            <p className="text-sm text-red-600">{actionError}</p>
          )}

          {hearingNotice ? (
            <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{hearingNotice}</p>
            </div>
          ) : confirming ? (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm">
                {confirming === "cancel"
                  ? t.confirmCancel
                  : t.confirmIssueWithout}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setConfirming(null)}
                >
                  {dict.common.cancel}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    const choice = confirming;
                    run(choice, async () => {
                      if (choice === "cancel") await onCancelInvoice();
                      else await onIssueWithoutAllocation();
                      setConfirming(null);
                    });
                  }}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : confirming === "cancel" ? (
                    t.option.cancel.label
                  ) : (
                    t.option.issue_without_allocation.label
                  )}
                </Button>
              </div>
            </div>
          ) : (
          <div className="space-y-2">
            {details.options.map((option) => {
              const copy = t.option[option];
              const isBusy = isPending && busyOption === option;
              const deadlineNote =
                option === "hearing" ? hearingNote : null;
              return (
                <button
                  key={option}
                  type="button"
                  disabled={isPending}
                  onClick={() => handle(option)}
                  className="flex w-full items-start gap-3 rounded-md border p-3 text-start transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                  ) : null}
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">
                      {copy.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {copy.description}
                    </span>
                    {deadlineNote && (
                      <span className="block text-xs font-medium text-amber-700">
                        {deadlineNote}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {dict.common.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
