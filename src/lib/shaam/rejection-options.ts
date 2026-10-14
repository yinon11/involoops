/**
 * Spec 08+ — turning an ITA refusal into a decision the seller can make.
 *
 * When רשות המסים declines to allocate a number, the law leaves the
 * seller four ways out (see `docs/ita-compliance/shaam-rejection-plan.md`
 * §2). Which ones actually apply depends on *why* it was refused, so this
 * module maps the ITA's answer onto the subset worth offering.
 *
 * The distinction that matters: a validation refusal is a data problem
 * the seller can fix and resubmit, while an administrative refusal is a
 * decision on the merits — resubmitting the same document will be
 * refused again, and the only real remedies are the statutory ones.
 * Conflating the two is what makes a rejection feel like a dead end.
 */

import { explainShaamError, explainShaamHttpStatus } from "./error-messages";

export const SHAAM_REJECTION_OPTIONS = [
  /** Correct the document (usually the customer's tax id) and resubmit. */
  "fix_and_retry",
  /**
   * Issue anyway, with no allocation number. Legal — the sale stands and
   * the seller reports it — but the buyer cannot deduct input VAT, so
   * this is never a silent default.
   */
  "issue_without_allocation",
  /** Buyer self-invoices at 0% VAT and draws their own allocation. */
  "reverse_charge",
  /** Formally contest the refusal (שימוע). */
  "hearing",
  /** Abandon the sale. The fiscal number stays spent. */
  "cancel",
] as const;

export type ShaamRejectionOption = (typeof SHAAM_REJECTION_OPTIONS)[number];

/**
 * Whether the reverse-charge flow (§5) is built. It is (route B,
 * `spec-audit-v2.md` §5.3): choosing it sends the seller to the
 * reverse-charge panel for the buyer's signature, and issuing the draft
 * with reverse charge applied sends the action-3 request. Nothing is sent
 * to the Tax Authority from the dialog itself.
 */
export const REVERSE_CHARGE_READY = true;

export type ShaamRejectionKind =
  /** Data problem — fixable, resubmittable. */
  | "validation"
  /** Refused on the merits. Retrying the same document is pointless. */
  | "administrative"
  /** ITA has not decided yet (codes 460/461). */
  | "pending_decision"
  /** Our own authorization/transport failure — not an ITA decision. */
  | "our_fault"
  /**
   * The ITA declined on a permission, not on the invoice (HTTP 406).
   * Nothing was adjudicated, so there is nothing to contest at a hearing.
   */
  | "permission"
  /** Unrecognised code: treat conservatively, offer everything. */
  | "unknown";

export interface ShaamRejectionClassification {
  kind: ShaamRejectionKind;
  /** Offered in this order; the UI renders the first as primary. */
  options: ShaamRejectionOption[];
  /**
   * i18n key suffix under `shaamSubmission.rejectionReason.*`. Falls back
   * to the verbatim ITA message when we have no mapping for the code.
   */
  reasonKey: string | null;
}

/**
 * ITA v2.0 codes we recognise. 460/461/462 come from the clearance spec
 * (§2.2, Israel Invoice Model 7/2024) and are already branched on in
 * `client.ts`; the rest are the validation failures seen most often in
 * UAT. Anything not listed falls through to `unknown`.
 */
const VALIDATION_CODES = new Set([
  "10", // malformed request body
  "20", // invalid seller VAT id
  "30", // invalid customer VAT id — by far the most common in practice
  "40", // amount / VAT mismatch
  "50", // invalid document type
  "434", // invoice date too old to clear — fix the date and resubmit
  "no_allocation_number", // approved=true with no parseable number
]);

const ADMINISTRATIVE_CODES = new Set([
  "462", // unapproved + decision sent — terminal
]);

const PENDING_DECISION_CODES = new Set([
  "460", // unapproved, no decision yet
  "461", // unapproved invoice exists, no decision yet
]);

/**
 * `submitDocumentToShaam` writes these when the failure was ours (an
 * expired token, a timeout, an exhausted retry loop) rather than the
 * ITA's. Offering "request a hearing" for our own bug would be absurd.
 */
function isOurFault(errorCode: string | null): boolean {
  if (!errorCode) return false;
  return (
    errorCode.startsWith("auth_") ||
    errorCode === "timeout" ||
    errorCode === "network_error" ||
    errorCode === "max_retries_exceeded"
  );
}

export function classifyShaamRejection(params: {
  errorCode: string | null;
  /** Customers without a tax id cannot take a reverse charge. */
  customerIsOsekMurshe: boolean;
  /**
   * The response's HTTP status. Optional only so existing callers that
   * genuinely have no submission to read still compile; pass it whenever
   * it is known, because for 400/406/422 it carries more truth than the
   * body's error code does.
   */
  httpStatus?: number | null;
}): ShaamRejectionClassification {
  const code = params.errorCode?.trim() || null;
  const status = params.httpStatus ?? null;

  if (isOurFault(code)) {
    return {
      kind: "our_fault",
      options: ["fix_and_retry", "issue_without_allocation", "cancel"],
      reasonKey: "ourFault",
    };
  }

  /**
   * Reverse charge is offered only for a customer with a tax id: the
   * buyer has to self-report the VAT, which only a VAT-registered business
   * can do. (The consent request checks the number properly — nine digits
   * and the check digit — before anything is sent.)
   */
  const withReverseCharge = (
    options: ShaamRejectionOption[],
  ): ShaamRejectionOption[] =>
    REVERSE_CHARGE_READY && params.customerIsOsekMurshe
      ? options
      : options.filter((o) => o !== "reverse_charge");

  // The HTTP status is checked before any error code, and that ordering
  // is the fix. A 422 whose body carries a code we do not recognise used
  // to fall through to `unknown`, which offers every statutory option —
  // so our own malformed request produced a dialog inviting the seller to
  // demand a hearing at the Tax Authority over a schema bug of ours.
  //
  // None of these three is a refusal on the merits. Only 200 +
  // approved=false + 462 is, and it never reaches here with a status that
  // has an entry.
  const httpMeaning = explainShaamHttpStatus(status);
  if (httpMeaning) {
    if (status === 422) {
      // Ours. `fix_and_retry` is deliberately absent — there is nothing
      // on the document for the seller to change.
      return {
        kind: "our_fault",
        options: ["issue_without_allocation", "cancel"],
        reasonKey: httpMeaning.reasonKey,
      };
    }
    if (status === 406) {
      // A permission problem: this seller is not cleared for the model,
      // or (on a reverse charge) the buyer is not eligible. No hearing —
      // nothing was judged. No reverse charge — it may be the very thing
      // being refused.
      return {
        kind: "permission",
        options: ["fix_and_retry", "issue_without_allocation", "cancel"],
        reasonKey: httpMeaning.reasonKey,
      };
    }
    // 400 — logically incorrect data. Genuinely the seller's to fix, but
    // still not something to contest, so no hearing.
    return {
      kind: "validation",
      options: ["fix_and_retry", "issue_without_allocation", "cancel"],
      // A recognised body code says more than the status does; the
      // status is the floor, not the ceiling.
      reasonKey: explainShaamError(code)?.reasonKey ?? httpMeaning.reasonKey,
    };
  }

  if (code && ADMINISTRATIVE_CODES.has(code)) {
    // Refused on the merits: "fix and retry" is deliberately absent —
    // offering it would send the seller round a loop that cannot succeed.
    return {
      kind: "administrative",
      options: withReverseCharge([
        "hearing",
        "issue_without_allocation",
        "reverse_charge",
        "cancel",
      ]),
      reasonKey: "administrative",
    };
  }

  if (code && PENDING_DECISION_CODES.has(code)) {
    return {
      kind: "pending_decision",
      options: withReverseCharge([
        "issue_without_allocation",
        "reverse_charge",
        "hearing",
        "cancel",
      ]),
      reasonKey: "pendingDecision",
    };
  }

  if (code && VALIDATION_CODES.has(code)) {
    return {
      kind: "validation",
      options: ["fix_and_retry", "issue_without_allocation", "cancel"],
      // Shared with the status panel via `explainShaamError`, so a code
      // never means one thing in the dialog and another on the page.
      reasonKey: explainShaamError(code)?.reasonKey ?? `code_${code}`,
    };
  }

  // Unknown code — surface the ITA's own message and keep every door
  // open rather than guessing that it is terminal.
  return {
    kind: "unknown",
    options: withReverseCharge([
      "fix_and_retry",
      "issue_without_allocation",
      "reverse_charge",
      "hearing",
      "cancel",
    ]),
    reasonKey: null,
  };
}
