"use server";

/*
 * Spec 08 — admin-facing actions for SHAAM-state remediation on a
 * specific document. These are the actions surfaced by the SHAAM
 * status panel on the invoice detail page and the admin submissions
 * log.
 */

import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { db } from "@/db";
import { outboundInvoices, shaamSubmissions } from "@/db/schema";
import { submitDocumentToShaam } from "@/lib/shaam/submit";
import { notifyShaamDecision } from "@/lib/shaam/notify-decision";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { finalizeAfterShaamClear } from "@/lib/outbound/finalize-pdf";
import { requireDocumentActor as requireDocumentActorFor } from "@/lib/outbound/document-actor";

/** Cross-tenant reads (the admin submissions log) stay platform-admin. */
async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!(await isUserAdmin(session.user.id))) throw new Error("Forbidden");
  return session.user.id;
}

function requireDocumentActor(documentId: string) {
  return requireDocumentActorFor(documentId, "shaam-invoice-actions");
}

export async function retrySubmission(documentId: string): Promise<
  | { ok: true; status: string; allocationNumber: string | null }
  | { ok: false; error: string }
> {
  const { userId: actorUserId } = await requireDocumentActor(documentId);
  try {
    const [current] = await db
      .select({
        shaamActionCode: outboundInvoices.shaamActionCode,
        shaamStatus: outboundInvoices.shaamStatus,
      })
      .from(outboundInvoices)
      .where(eq(outboundInvoices.id, documentId))
      .limit(1);
    if (current?.shaamStatus === "ISSUED_WITHOUT_ALLOCATION") {
      return {
        ok: false,
        error:
          "This invoice was already issued without an allocation number.",
      };
    }
    const result = await submitDocumentToShaam({
      documentId,
      actorUserId,
      // Same as the cron: a reverse charge is retried as a reverse charge.
      actionCode: current?.shaamActionCode === 3 ? 3 : 1,
    });
    // An allocation number that is not on the PDF is not much use to the
    // customer, and leaves the document in a state `verify-document.ts`
    // reports as a half-state. Idempotent, so a replay costs nothing.
    const finalize = await finalizeAfterShaamClear({
      invoiceId: documentId,
      actorUserId,
      shaamStatus: result.shaamStatus,
      allocationNumber: result.allocationNumber,
    });
    revalidatePath(`/outbound/${documentId}`);
    if (finalize && !finalize.ok) {
      // The allocation did land — say so, but do not claim success while
      // the PDF the customer receives is still the interim one.
      return {
        ok: false,
        error: `Allocation ${result.allocationNumber} received, but the final PDF could not be produced: ${finalize.error}`,
      };
    }
    return {
      ok: true,
      status: result.shaamStatus,
      allocationNumber: result.allocationNumber,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ask the ITA for an allocation number on an invoice that did not need one.
 *
 * Spec §1.2 permits it outright — "an allocation number for each invoice may
 * be requested, for any amount and for each customer including credits" — and
 * the real-world trigger is a customer asking for a number on an invoice under
 * the threshold.
 *
 * The important part is what happens when the ITA says no. The document is
 * already issued and legal without a number, so a refusal must change
 * nothing: it must not flip the invoice to REJECTED, because that renders as
 * "the Tax Authority refused this invoice" and hands the seller the four
 * statutory remedies for a problem they do not have — one of which burns the
 * fiscal number and another of which stamps "your customer cannot deduct
 * input VAT" on a document where that was never at stake.
 *
 * That guarantee lives in `submitDocumentToShaam`'s `voluntary` flag, not
 * here: it makes `recordResult` write NOT_REQUIRED in the same transaction
 * that would otherwise commit the refusal. Undoing it from this function
 * afterwards was not good enough — `recordResult` commits, so there was a
 * real window in which the invoice read REJECTED, and a process death inside
 * it stranded the document in the dialog with no way back (this path is
 * gated to NOT_REQUIRED, so the seller could not even retry).
 *
 * The attempt stays in `shaam_submissions` either way.
 */
export async function requestAllocationAnyway(documentId: string): Promise<
  | { ok: true; status: string; allocationNumber: string | null }
  | { ok: false; error: string; declined?: boolean }
> {
  const { userId: actorUserId } = await requireDocumentActor(documentId);
  try {
    const [row] = await db
      .select()
      .from(outboundInvoices)
      .where(eq(outboundInvoices.id, documentId))
      .limit(1);
    if (!row) return { ok: false, error: "Invoice not found" };

    // Deliberately narrow: only a document the threshold rules excused. On
    // any other status the normal clearance flow owns the allocation, and a
    // second voluntary request would race it.
    if (row.shaamStatus !== "NOT_REQUIRED") {
      return {
        ok: false,
        error: `An allocation number can only be requested this way for an invoice that did not need one (status is ${row.shaamStatus}).`,
      };
    }
    if (row.status === "draft") {
      return { ok: false, error: "Issue the invoice first." };
    }

    const result = await submitDocumentToShaam({
      documentId,
      actorUserId,
      actionCode: 1,
      voluntary: true,
    });

    if (result.shaamStatus === "APPROVED" && result.allocationNumber) {
      const finalize = await finalizeAfterShaamClear({
        invoiceId: documentId,
        actorUserId,
        shaamStatus: result.shaamStatus,
        allocationNumber: result.allocationNumber,
      });
      revalidatePath(`/outbound/${documentId}`);
      if (finalize && !finalize.ok) {
        return {
          ok: false,
          error: `Allocation ${result.allocationNumber} received, but the final PDF could not be produced: ${finalize.error}`,
        };
      }
      return {
        ok: true,
        status: result.shaamStatus,
        allocationNumber: result.allocationNumber,
      };
    }

    // Not approved. Nothing to undo: `voluntary` made `recordResult` write
    // NOT_REQUIRED in the same transaction it would have committed the
    // refusal in, so the invoice never held a refused status at all. An
    // earlier version restored it here, afterwards — which left a committed
    // window, and a process death inside that window stranded the document
    // in the statutory dialog with no way back.
    // Keep the ITA's own code in front of the seller and in the server log.
    // A refusal on the merits and a malformed request or transport fault look
    // identical from the UI otherwise, and this is the path where nobody is
    // forced to care — so it is the path where a real API fault would sit
    // unnoticed longest.
    const [after] = await db
      .select({
        code: outboundInvoices.shaamLastErrorCode,
        message: outboundInvoices.shaamLastErrorMessage,
      })
      .from(outboundInvoices)
      .where(eq(outboundInvoices.id, documentId))
      .limit(1);
    console.warn(
      `[shaam] voluntary allocation request for ${documentId} not granted: ` +
        `outcome=${result.shaamStatus} code=${after?.code ?? "none"} ` +
        `message=${after?.message ?? "none"}`,
    );
    revalidatePath(`/outbound/${documentId}`);
    return {
      ok: false,
      declined: true,
      error: after?.code
        ? `No allocation number was issued (${after.code}${after.message ? `: ${after.message}` : ""}). The invoice is unaffected — it did not require one.`
        : "The Tax Authority did not issue an allocation number. The invoice is unaffected — it did not require one.",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Spec §4 — alternative 4, "Request for Hearing".
 *
 * The hearing itself is conducted through the Tax Authority's own service
 * channels, not through us. What the spec requires of the software is that
 * the ITA is told this is the route the seller chose, via
 * `InvoiceDecisionApi/v1/FurtherObjection`. Until this existed the option
 * showed guidance text and notified nobody.
 */
export async function requestShaamHearing(documentId: string): Promise<
  { ok: true; notified: boolean; reason?: string } | { ok: false; error: string }
> {
  const { userId: actorUserId } = await requireDocumentActor(documentId);
  try {
    const result = await notifyShaamDecision({
      documentId,
      choice: "request_hearing",
      actorUserId,
    });
    revalidatePath(`/outbound/${documentId}`);
    return { ok: true, notified: result.notified, reason: result.reason };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ShaamSubmissionRow {
  id: string;
  documentId: string;
  formattedNumber: string | null;
  businessEntityId: string;
  environment: string;
  actionCode: number;
  submittedAt: string;
  respondedAt: string | null;
  durationMs: number | null;
  responseStatus: string | null;
  responseHttpStatus: number | null;
  allocationNumber: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown> | null;
}

export async function listShaamSubmissions(filters: {
  businessEntityId?: string;
  documentId?: string;
  limit?: number;
} = {}): Promise<ShaamSubmissionRow[]> {
  await requireAdmin();
  const conditions = [];
  if (filters.businessEntityId) {
    conditions.push(
      eq(shaamSubmissions.businessEntityId, filters.businessEntityId),
    );
  }
  if (filters.documentId) {
    conditions.push(eq(shaamSubmissions.documentId, filters.documentId));
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(filters.limit ?? 100, 500);

  const query = db
    .select({
      id: shaamSubmissions.id,
      documentId: shaamSubmissions.documentId,
      formattedNumber: outboundInvoices.formattedNumber,
      businessEntityId: shaamSubmissions.businessEntityId,
      environment: shaamSubmissions.environment,
      actionCode: shaamSubmissions.actionCode,
      submittedAt: shaamSubmissions.submittedAt,
      respondedAt: shaamSubmissions.respondedAt,
      durationMs: shaamSubmissions.durationMs,
      responseStatus: shaamSubmissions.responseStatus,
      responseHttpStatus: shaamSubmissions.responseHttpStatus,
      allocationNumber: shaamSubmissions.responseAllocationNumber,
      errorCode: shaamSubmissions.responseErrorCode,
      errorMessage: shaamSubmissions.responseErrorMessage,
      requestId: shaamSubmissions.requestId,
      requestPayload: shaamSubmissions.requestPayload,
      responsePayload: shaamSubmissions.responsePayload,
    })
    .from(shaamSubmissions)
    .leftJoin(
      outboundInvoices,
      eq(shaamSubmissions.documentId, outboundInvoices.id),
    )
    .orderBy(desc(shaamSubmissions.submittedAt))
    .limit(limit);

  const raw = await (whereClause ? query.where(whereClause) : query);
  return raw.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    formattedNumber: r.formattedNumber ?? null,
    businessEntityId: r.businessEntityId,
    environment: r.environment,
    actionCode: r.actionCode,
    submittedAt: r.submittedAt.toISOString(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    responseStatus: r.responseStatus,
    responseHttpStatus: r.responseHttpStatus,
    allocationNumber: r.allocationNumber,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    requestId: r.requestId,
    requestPayload: (r.requestPayload ?? {}) as Record<string, unknown>,
    responsePayload:
      (r.responsePayload as Record<string, unknown> | null) ?? null,
  }));
}
