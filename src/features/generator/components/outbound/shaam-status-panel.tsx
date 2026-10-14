"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";
import { explainShaamError } from "@/lib/shaam/error-messages";
import {
  retrySubmission,
  requestAllocationAnyway,
} from "@/features/generator/actions/shaam-invoice-actions";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Loader2,
  Info,
} from "lucide-react";

type ShaamStatus =
  | "NOT_APPLICABLE"
  | "NOT_REQUIRED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "HELD"
  | "OUTAGE_ISSUED"
  | "ISSUED_WITHOUT_ALLOCATION"
  | "CANCELLED_AFTER_REJECTION"
  | "UNRESOLVED";

interface Props {
  documentId: string;
  status: ShaamStatus;
  allocationNumber: string | null;
  submittedAt: string | null;
  respondedAt: string | null;
  retryCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  /** מועד השימוע, ISO. Present only while a hold is unresolved. */
  hearingDeadline?: string | null;
  /**
   * Whether this viewer may actually run the remediation actions.
   *
   * The buttons used to render for everyone while the server actions
   * behind them checked a permission, so a viewer without it got
   * `Forbidden` on click — an offer the page could not honour. Resolved
   * server-side and passed in rather than guessed here.
   */
  canRemediate?: boolean;
  /** Re-opens the refusal options. Present on a rejected or held invoice. */
  onReviewOptions?: () => void;
  /**
   * A hold older than the reconcile window. We have stopped asking the
   * Tax Authority; the document is still waiting on the seller.
   */
  holdChecksStopped?: boolean;
  /**
   * Server-captured wall clock ms for the "N minutes ago" label.
   * Computed at page-render time so React Compiler's purity rule
   * doesn't flag `Date.now()` inside this client component.
   */
  nowMs: number;
}

export function ShaamStatusPanel({
  documentId,
  status,
  allocationNumber,
  submittedAt,
  respondedAt,
  retryCount,
  lastErrorCode,
  lastErrorMessage,
  hearingDeadline = null,
  canRemediate = false,
  onReviewOptions,
  holdChecksStopped = false,
  nowMs,
}: Props) {
  const router = useRouter();
  const { dict } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  if (status === "NOT_APPLICABLE") return null;

  function handleRetry() {
    setActionMsg(null);
    startTransition(async () => {
      const res = await retrySubmission(documentId);
      if (res.ok) {
        setActionMsg(`→ ${res.status}`);
        router.refresh();
      } else {
        setActionMsg(res.error);
      }
    });
  }

  function handleRequestAnyway() {
    setActionMsg(null);
    startTransition(async () => {
      const res = await requestAllocationAnyway(documentId);
      if (res.ok) {
        setActionMsg(res.allocationNumber ?? "");
        router.refresh();
      } else {
        // A decline is information, not a failure: the invoice never needed
        // a number and is unchanged.
        setActionMsg(res.error);
        if (res.declined) router.refresh();
      }
    });
  }

  const submittedAgo = submittedAt
    ? formatAgo(new Date(submittedAt), nowMs)
    : null;

  if (status === "APPROVED") {
    return (
      <Card className="border-green-200 bg-green-50">
        <div className="flex items-start gap-3 p-4">
          <CheckCircle2 className="h-5 w-5 text-green-700" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-green-900">
                {dict.shaamSubmission.status.APPROVED}
              </span>
              {allocationNumber && (
                <Badge className="bg-green-700 font-mono text-white">
                  {highlightLast9(allocationNumber)}
                </Badge>
              )}
            </div>
            {respondedAt && (
              <p className="text-xs text-green-800/80">
                {dict.shaamSubmission.receivedAt}:{" "}
                {new Date(respondedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  if (status === "NOT_REQUIRED") {
    // `lastErrorCode` on this status is one of three things: a skip reason
    // written by `submitDocumentToShaam`, an ITA response code left by a
    // request that was made but not granted (a voluntary ask, or an issue
    // where no number was owed), or null on rows written before either.
    const SKIP_REASONS = [
      "below_threshold",
      "pre_threshold_date",
      "zero_vat",
      "foreign_currency",
      "no_customer_tax_id",
    ];
    const cannotAsk = lastErrorCode === "no_customer_tax_id";
    // Asked and not granted. Not an error to the seller — the document is
    // issued and legal — but the ITA's code is kept in front of them, since
    // a transport or payload fault looks identical from here otherwise.
    const askedAndDeclined =
      !!lastErrorCode && !SKIP_REASONS.includes(lastErrorCode);
    return (
      <Card className="border-gray-200 bg-gray-50">
        <div className="flex items-start gap-3 p-4 text-sm text-gray-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1 space-y-2">
            {/*
              "Not required" and "we could not ask" are different facts, and
              this panel used to state the first for both. A customer with no
              9-digit licensed-dealer number on file is not exempt — the
              request cannot be built without it. Saying "not required" there
              sends the seller away from the one thing that would fix it, and
              offering the button below would be offering a doomed call.
            */}
            {cannotAsk ? (
              <p className="text-amber-800">
                {dict.shaamSubmission.notRequestedNoTaxId}
              </p>
            ) : askedAndDeclined ? (
              <>
                <p>{dict.shaamSubmission.noAllocationButIssued}</p>
                <p className="font-mono text-[11px] text-gray-500">
                  {format(dict.shaamSubmission.noAllocationItaCode, {
                    code: lastErrorCode ?? "",
                  })}
                  {lastErrorMessage ? ` — ${lastErrorMessage}` : ""}
                </p>
              </>
            ) : (
              <p>{dict.shaamSubmission.status.NOT_REQUIRED}</p>
            )}
            {/*
              Not required is not the same as not allowed: spec §1.2 permits
              requesting a number "for any amount and for each customer".
              Offered here rather than at issue time on purpose — the trigger
              is a customer asking afterwards, and a refusal at issue time
              would block a legal invoice behind remedies it does not need.
            */}
            {canRemediate && !cannotAsk && (
              <>
                <p className="text-xs text-gray-500">
                  {dict.shaamSubmission.requestAnywayHint}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={handleRequestAnyway}
                  className="gap-1"
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {dict.shaamSubmission.action.requestAllocationAnyway}
                </Button>
                {actionMsg && (
                  <p className="text-[11px] text-gray-600">{actionMsg}</p>
                )}
              </>
            )}
          </div>
        </div>
      </Card>
    );
  }

  if (status === "PENDING" || status === "OUTAGE_ISSUED") {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <div className="flex items-start gap-3 p-4">
          <Clock className="h-5 w-5 text-amber-700" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-amber-900">
                {dict.shaamSubmission.status[status]}
              </span>
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                {format(dict.shaamSubmission.retryCount, {
                  n: String(retryCount),
                })}
              </Badge>
            </div>
            {submittedAgo && (
              <p className="text-xs text-amber-900/80">
                {format(dict.shaamSubmission.lastAttempt, { time: submittedAgo })}
              </p>
            )}
            <ShaamErrorDetail
              code={lastErrorCode}
              message={lastErrorMessage}
              dict={dict}
              tone="text-amber-900/80"
            />
            {canRemediate && (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={handleRetry}
                className="gap-1"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {dict.shaamSubmission.action.retry}
              </Button>
            )}
            {actionMsg && (
              <p className="text-[11px] text-amber-900/70">{actionMsg}</p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  if (status === "HELD") {
    return (
      <Card className="border-orange-300 bg-orange-50">
        <div className="flex items-start gap-3 p-4">
          <AlertTriangle className="h-5 w-5 text-orange-700" />
          <div className="flex-1 space-y-2">
            <span className="font-semibold text-orange-900">
              {dict.shaamSubmission.status.HELD}
            </span>
            <ShaamErrorDetail
              code={lastErrorCode}
              message={lastErrorMessage}
              dict={dict}
              tone="text-orange-900/80"
            />
            <HearingDeadline
              deadline={hearingDeadline}
              nowMs={nowMs}
              dict={dict}
            />
            {holdChecksStopped && (
              <p className="text-sm text-orange-950">
                {dict.shaamSubmission.holdChecksStopped}
              </p>
            )}
            {canRemediate && onReviewOptions && (
              <Button
                size="sm"
                variant="outline"
                onClick={onReviewOptions}
                className="gap-1"
              >
                {dict.shaamSubmission.action.reviewOptions}
              </Button>
            )}
            {actionMsg && (
              <p className="text-[11px] text-orange-900/70">{actionMsg}</p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // Not a refusal — our retry ladder ran out. The only useful action is
  // to ask again, so this deliberately does not offer the statutory
  // options that a real refusal does.
  if (status === "UNRESOLVED") {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <div className="flex items-start gap-3 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-700" />
          <div className="flex-1 space-y-2">
            <span className="font-semibold text-amber-900">
              {dict.shaamSubmission.status.UNRESOLVED}
            </span>
            {lastErrorMessage && (
              <p className="text-sm text-amber-900/80">{lastErrorMessage}</p>
            )}
            {canRemediate && (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={handleRetry}
                className="gap-1"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {dict.shaamSubmission.action.retry}
              </Button>
            )}
            {actionMsg && (
              <p className="text-[11px] text-amber-900/70">{actionMsg}</p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // The document is already issued. Asking the Tax Authority again would
  // not change that, so this warning has no action.
  if (status === "ISSUED_WITHOUT_ALLOCATION") {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <div className="flex items-start gap-3 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-700" />
          <div className="flex-1 space-y-1">
            <span className="font-semibold text-amber-900">
              {dict.shaamSubmission.status.ISSUED_WITHOUT_ALLOCATION}
            </span>
            <p className="text-sm text-amber-900/80">
              {dict.shaamSubmission.rejection.issuedWithoutBanner}
            </p>
            {lastErrorCode && (
              <p className="text-xs font-mono text-amber-900/70">
                {lastErrorCode}: {lastErrorMessage}
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  if (status === "CANCELLED_AFTER_REJECTION") {
    return (
      <Card className="border-gray-300 bg-gray-50">
        <div className="flex items-start gap-3 p-4">
          <Info className="h-5 w-5 text-gray-600" />
          <div className="flex-1 space-y-1">
            <span className="font-semibold text-gray-800">
              {dict.shaamSubmission.status.CANCELLED_AFTER_REJECTION}
            </span>
            {lastErrorCode && (
              <p className="text-xs font-mono text-gray-600">
                {lastErrorCode}: {lastErrorMessage}
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // REJECTED
  return (
    <Card className="border-red-300 bg-red-50">
      <div className="flex items-start gap-3 p-4">
        <XCircle className="h-5 w-5 text-red-700" />
        <div className="flex-1 space-y-2">
          <span className="font-semibold text-red-900">
            {dict.shaamSubmission.status.REJECTED}
          </span>
          <ShaamErrorDetail
            code={lastErrorCode}
            message={lastErrorMessage}
            dict={dict}
            tone="text-red-900"
          />
          {canRemediate && (
            <div className="flex flex-wrap gap-2">
              {onReviewOptions && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onReviewOptions}
                  className="gap-1"
                >
                  {dict.shaamSubmission.action.reviewOptions}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={handleRetry}
                className="gap-1"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {dict.shaamSubmission.action.retry}
              </Button>
            </div>
          )}
          {actionMsg && (
            <p className="text-[11px] text-red-900/70">{actionMsg}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The seller's clock on a hold. Rendered as time remaining rather than a
 * bare date because "3 days left" is the part that drives a decision, and
 * a passed deadline is worth calling out on its own — it can mean the
 * Tax Authority's own window closed.
 */
function HearingDeadline({
  deadline,
  nowMs,
  dict,
}: {
  deadline: string | null;
  nowMs: number;
  dict: ReturnType<typeof useI18n>["dict"];
}) {
  if (!deadline) return null;
  const when = new Date(deadline);
  if (Number.isNaN(when.getTime())) return null;

  const t = dict.shaamSubmission;
  const date = when.toLocaleDateString();
  const remainingMs = when.getTime() - nowMs;

  if (remainingMs <= 0) {
    return (
      <div className="rounded border border-orange-400 bg-orange-100/70 p-2">
        <p className="text-xs font-semibold text-orange-900">
          {format(t.hearingDeadlinePassed, { date })}
        </p>
        <p className="mt-1 text-[11px] text-orange-900/80">
          {t.hearingDeadlinePassedNote}
        </p>
      </div>
    );
  }

  return (
    <p className="text-xs font-semibold text-orange-900">
      {format(t.hearingDeadlineLeft, {
        date,
        time: formatDuration(remainingMs),
      })}
    </p>
  );
}

/** Coarse on purpose: the useful granularity here is days, then hours. */
function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d`;
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m`;
}

/**
 * The ITA's own words, then ours. Never ours instead of theirs: the raw
 * message is the authoritative record an accountant will ask to see, and
 * a code we do not recognise gets no invented explanation at all.
 */
function ShaamErrorDetail({
  code,
  message,
  dict,
  tone,
}: {
  code: string | null;
  message: string | null;
  dict: ReturnType<typeof useI18n>["dict"];
  tone: string;
}) {
  if (!code && !message) return null;
  const explanation = explainShaamError(code);
  const reason = explanation
    ? (
        dict.shaamSubmission.rejection.reason as Record<
          string,
          string | undefined
        >
      )[explanation.reasonKey]
    : undefined;
  const action = explanation
    ? dict.shaamSubmission.rejection.action[explanation.action]
    : undefined;

  return (
    <div className="space-y-1">
      <p className={`text-xs font-mono ${tone}`}>
        {code ? `${code}: ` : ""}
        {message}
      </p>
      {reason && <p className={`text-sm ${tone}`}>{reason}</p>}
      {action && <p className={`text-xs font-medium ${tone}`}>{action}</p>}
    </div>
  );
}

function highlightLast9(n: string): string {
  if (n.length <= 9) return n;
  return n;
}

function formatAgo(then: Date, now: number): string {
  const diffSec = Math.max(1, Math.floor((now - then.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}
