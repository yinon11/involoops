/**
 * Orchestration for the ITA decision-update service (v2.0 spec §4).
 *
 * Mirrors `submitDocumentToShaam`: resolve the entity, honour the sandbox
 * rules, get a token, post, and record the attempt in `shaam_submissions`
 * so the admin log shows it alongside every clearance call.
 *
 * One deliberate difference: this never throws and never fails the caller.
 * The seller's decision has already been made and recorded locally by the
 * time we get here. A failure to *notify* the ITA is a reconciliation
 * problem — it must not undo a cancellation or un-issue an invoice, which
 * would strand the document a second time for a reason the seller cannot
 * act on. Failures are recorded and surfaced in the admin submissions log.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { businessEntities, outboundInvoices, shaamSubmissions } from "@/db/schema";
import { appendAuditEntry } from "@/lib/audit/append";
import { getActiveAccessToken, hasActiveAuthorization } from "./authorization";
import { getShaamConfig } from "./client";
import { shaamInvoiceId } from "./payload";
import {
  getShaamUatDecisionUrl,
  submitDecision,
  type ShaamDecision,
} from "./decision";
import { shaamWarn } from "./debug";
import { SANDBOX_MOCK_REQUEST_ID } from "./sandbox-mock-outcome";

/**
 * Spec §4.1 numbers the alternatives 1–4; 3 (reverse charge) goes through
 * the Approval service instead, so it has no mapping here.
 */
export type ShaamDecisionChoice =
  | "cancel"
  | "issue_without_allocation"
  | "request_hearing";

const ENDPOINT: Record<ShaamDecisionChoice, ShaamDecision> = {
  cancel: "Cancel",
  issue_without_allocation: "Continue",
  request_hearing: "FurtherObjection",
};

/**
 * The choices the retry scan may act on. Rows written before the choice
 * was stored in `response_error_code` hold an ITA error code there
 * instead; matching against this list is what keeps the scan from
 * feeding one of those back in as if it were a choice.
 */
export const DECISION_CHOICES = Object.keys(ENDPOINT) as ShaamDecisionChoice[];

export interface NotifyDecisionResult {
  notified: boolean;
  /** Why we did not notify, when `notified` is false. */
  reason?: string;
}

/**
 * How many times we will try to report one decision before giving up.
 * A decision either lands or it does not — unlike a clearance request
 * there is no "the ITA is still deciding" state to wait out — so this is
 * a flat cap rather than a ladder.
 */
export const MAX_DECISION_ATTEMPTS = 8;

/**
 * Minimum gap between attempts at the same decision. The reconciliation
 * cron runs every 15 minutes; without this the cap above would be spent
 * in two hours, which is no help at all against the outage it exists for.
 */
export const DECISION_RETRY_INTERVAL_MS = 60 * 60 * 1000;

/** Rows this module writes, distinguished from clearance by action code. */
export const DECISION_ACTION_CODE = 0;

export interface StuckDecision {
  documentId: string;
  choice: ShaamDecisionChoice;
  attempts: number;
}

/**
 * Decisions the ITA has not accepted yet and that are still worth another
 * try. Lives here rather than inline in the cron so the verification
 * harness can run the real predicate against a real database — the same
 * reason `buildReconcileScanWhere` is its own function.
 *
 * Grouped by `(document_id, response_error_code)` because the log is one
 * row per attempt and the choice is what identifies the decision. A
 * document can legitimately appear once per choice: a hearing that the
 * ITA later refuses ends in a cancellation, and both are owed.
 */
export async function findUnnotifiedDecisions(
  now: number,
  limit = 100,
): Promise<StuckDecision[]> {
  const rows = await db
    .select({
      documentId: shaamSubmissions.documentId,
      choice: shaamSubmissions.responseErrorCode,
      attempts: sql<number>`count(*)::int`,
    })
    .from(shaamSubmissions)
    .where(
      and(
        eq(shaamSubmissions.actionCode, DECISION_ACTION_CODE),
        // Legacy rows carry the ITA's error code in this column; only a
        // real choice can be replayed.
        inArray(shaamSubmissions.responseErrorCode, DECISION_CHOICES),
      ),
    )
    .groupBy(shaamSubmissions.documentId, shaamSubmissions.responseErrorCode)
    .having(
      sql`count(*) filter (where ${shaamSubmissions.responseStatus} = 'APPROVED') = 0
          and count(*) < ${MAX_DECISION_ATTEMPTS}
          and max(${shaamSubmissions.submittedAt}) < ${new Date(
            now - DECISION_RETRY_INTERVAL_MS,
          ).toISOString()}::timestamptz`,
    )
    .limit(limit);

  return rows.flatMap((r) =>
    r.documentId && r.choice
      ? [
          {
            documentId: r.documentId,
            choice: r.choice as ShaamDecisionChoice,
            attempts: r.attempts,
          },
        ]
      : [],
  );
}

function resolveAccountingSoftwareNumber(): number | undefined {
  const raw =
    process.env.SHAAM_ACCOUNTING_SOFTWARE_NUMBER?.trim() ||
    process.env.SOFTWARE_HOUSE_VAT_NUMBER?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export async function notifyShaamDecision(params: {
  documentId: string;
  choice: ShaamDecisionChoice;
  actorUserId: string;
  /** The user's own tax id / email, for the `user_id` / `user_name` fields. */
  actorTaxId?: string | null;
  actorName?: string | null;
}): Promise<NotifyDecisionResult> {
  try {
    const [invoice] = await db
      .select()
      .from(outboundInvoices)
      .where(eq(outboundInvoices.id, params.documentId))
      .limit(1);
    if (!invoice) return { notified: false, reason: "document_not_found" };

    // The decision service keys on the invoice_id of the original
    // clearance request. Without one there is nothing for the ITA to
    // match — §4.2 answers that case with 463.
    if (!invoice.formattedNumber) {
      return { notified: false, reason: "no_invoice_id" };
    }

    // Two guards before we spend a request, both reading the same
    // append-only log the attempt will be written to.
    const [priorAttempts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        accepted: sql<number>`count(*) filter (where ${shaamSubmissions.responseStatus} = 'APPROVED')::int`,
      })
      .from(shaamSubmissions)
      .where(
        and(
          eq(shaamSubmissions.documentId, params.documentId),
          eq(shaamSubmissions.actionCode, DECISION_ACTION_CODE),
          eq(shaamSubmissions.responseErrorCode, params.choice),
        ),
      );
    if ((priorAttempts?.accepted ?? 0) > 0) {
      return { notified: true, reason: "already_notified" };
    }
    if ((priorAttempts?.total ?? 0) >= MAX_DECISION_ATTEMPTS) {
      return { notified: false, reason: "attempts_exhausted" };
    }

    const [entity] = await db
      .select()
      .from(businessEntities)
      .where(eq(businessEntities.id, invoice.businessEntityId))
      .limit(1);
    if (!entity) return { notified: false, reason: "entity_not_found" };

    const cfg = getShaamConfig();
    let environment = cfg.environment;
    let decisionUrl: string | undefined;
    // A refusal forced by the sandbox mock setting never reached the ITA,
    // so there is nothing there to decide about either. (Any business on
    // the sandbox stack can carry one, flagged sandbox or not.)
    if (invoice.shaamRequestId === SANDBOX_MOCK_REQUEST_ID) {
      return { notified: false, reason: "sandbox_mock" };
    }
    if (entity.shaamSandbox) {
      const uatReady = await hasActiveAuthorization(
        invoice.businessEntityId,
        "UAT",
      );
      // A sandbox entity with no UAT grant has a locally mocked clearance
      // history, so there is no invoice at the ITA to decide about.
      if (!uatReady) return { notified: false, reason: "sandbox_no_grant" };
      environment = "UAT";
      decisionUrl = getShaamUatDecisionUrl(ENDPOINT[params.choice]);
    }

    const accessToken = await getActiveAccessToken({
      businessEntityId: invoice.businessEntityId,
      environment,
    });

    // Shared with the clearance payload builder on purpose: the decision
    // service matches on the id the original request registered.
    const invoiceId = shaamInvoiceId(invoice.formattedNumber);

    const osek = Number(entity.osekMurshe);
    const correlationId = randomUUID();
    const payload = {
      invoice_id: invoiceId,
      vat_number: Number.isFinite(osek) ? osek : 0,
      accounting_software_number: resolveAccountingSoftwareNumber(),
      ...(params.actorTaxId && Number.isFinite(Number(params.actorTaxId))
        ? { user_id: Number(params.actorTaxId) }
        : {}),
      ...(params.actorName ? { user_name: params.actorName.slice(0, 25) } : {}),
    };

    const submittedAt = new Date();
    const result = await submitDecision({
      accessToken,
      decision: ENDPOINT[params.choice],
      payload,
      correlationId,
      decisionUrl,
    });
    const respondedAt = new Date();

    const accepted = result.result === "ACCEPTED";
    // Recorded in the same append-only log as clearance calls, so the
    // admin submissions view shows the decision alongside the refusal it
    // answers. `actionCode` 0 marks "not a clearance action".
    await db.insert(shaamSubmissions).values({
      documentId: invoice.id,
      businessEntityId: invoice.businessEntityId,
      environment,
      actionCode: 0,
      // Unique per attempt. A fixed key collided with
      // `shaam_submissions_idempotency_unique` on the second call, which
      // meant a retry failed on our own constraint without ever reaching
      // the ITA. This table is documented as one row per attempt.
      idempotencyKey: `decision-${params.choice}-${invoice.id}-${correlationId}`,
      requestPayload: payload as unknown as Record<string, unknown>,
      requestPayloadHash: correlationId,
      responsePayload:
        "rawResponse" in result
          ? (result.rawResponse as Record<string, unknown> | null)
          : null,
      responseHttpStatus: "httpStatus" in result ? result.httpStatus : null,
      responseStatus: accepted ? "APPROVED" : "REJECTED",
      // Carries the choice, not an error code: the retry scan and the
      // guards above both need to know which decision a row is for, and
      // there is no dedicated column for it. The ITA's own error code
      // goes in the message alongside its text.
      responseErrorCode: params.choice,
      responseErrorMessage:
        result.result === "REJECTED"
          ? `${result.errorCode ?? "?"}: ${result.errorMessage}`
          : result.result === "NETWORK_ERROR"
            ? result.cause.message
            : result.result === "TIMEOUT"
              ? "decision request timed out"
              : null,
      requestId: correlationId,
      submittedAt,
      respondedAt,
      durationMs: "elapsedMs" in result ? result.elapsedMs : null,
    });

    await appendAuditEntry({
      businessEntityId: invoice.businessEntityId,
      userId: invoice.userId,
      documentId: invoice.id,
      documentType: invoice.documentType,
      eventType: "SHAAM_REJECTION_RESOLVED",
      eventPayload: {
        // Distinguishes this from the entry written where the seller's
        // choice was recorded — same event type, different moment.
        phase: "ita_notified",
        choice: params.choice,
        itaEndpoint: ENDPOINT[params.choice],
        itaNotified: accepted,
        outcome: result.result,
      },
      actor: { userId: params.actorUserId },
    });

    if (!accepted) {
      shaamWarn("decision.notify", "ITA not updated", {
        document_id: invoice.id,
        choice: params.choice,
        outcome: result.result,
      });
    }
    return accepted
      ? { notified: true }
      : { notified: false, reason: result.result };
  } catch (err) {
    // Never propagate: see the module comment.
    shaamWarn("decision.notify", "threw", {
      document_id: params.documentId,
      choice: params.choice,
      error: err instanceof Error ? err.message : String(err),
    });
    return { notified: false, reason: "error" };
  }
}
