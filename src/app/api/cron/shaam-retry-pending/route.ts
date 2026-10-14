import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { outboundInvoices } from "@/db/schema";
import { submitDocumentToShaam } from "@/lib/shaam/submit";
import {
  findUnnotifiedDecisions,
  notifyShaamDecision,
} from "@/lib/shaam/notify-decision";
import {
  buildReconcileScanWhere,
  DEFAULT_BATCH_LIMIT,
  DEFAULT_RUN_BUDGET_MS,
  envInt,
  MAX_RETRIES,
} from "@/lib/shaam/reconcile-scan";
import { finalizeAfterShaamClear } from "@/lib/outbound/finalize-pdf";
import {
  callerFromUserId,
  sendOutboundInvoiceByEmailOp,
} from "@/lib/outbound/operations";

function verifyCronSecret(authHeader: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const provided = authHeader.slice("Bearer ".length);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Spec 08 — reconciliation cron. Every 15 minutes we scan for documents
 * still waiting on the ITA and try to clear them:
 *
 *   - PENDING / OUTAGE_ISSUED → transient ladder, retired after
 *     `MAX_RETRIES`.
 *   - HELD → slow ladder, kept alive for `HELD_MAX_AGE_MS` because the
 *     ITA may still decide in the seller's favour.
 *
 * Then a second phase retries decision notifications (§4 of the ITA spec)
 * that never landed — see the comment at that block for why it lives here
 * rather than in a cron of its own.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const startedAt = now;
  const batchLimit = envInt("SHAAM_RETRY_BATCH_SIZE", DEFAULT_BATCH_LIMIT);
  const runBudgetMs = envInt("SHAAM_RETRY_RUN_BUDGET_MS", DEFAULT_RUN_BUDGET_MS);

  // Retire exhausted transient retries in one statement, before the scan,
  // so the batch window is spent on documents that can still clear rather
  // than on ones we are only going to give up on.
  const retired = await db
    .update(outboundInvoices)
    .set({
      shaamStatus: "UNRESOLVED",
      shaamLastErrorCode: "max_retries_exceeded",
      shaamLastErrorMessage:
        "SHAAM clearance retries exhausted; manual intervention required.",
      shaamResponseAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(outboundInvoices.shaamStatus, ["PENDING", "OUTAGE_ISSUED"]),
        gte(outboundInvoices.shaamRetryCount, MAX_RETRIES),
      ),
    )
    .returning({ id: outboundInvoices.id });

  const scanWhere = buildReconcileScanWhere(now);

  // Counted separately from the batch so a backlog is reported rather
  // than hidden behind a full page of results.
  const [eligibleRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outboundInvoices)
    .where(scanWhere);
  const eligible = eligibleRow?.count ?? 0;

  const scan = db
    .select({
      id: outboundInvoices.id,
      shaamStatus: outboundInvoices.shaamStatus,
      shaamRetryCount: outboundInvoices.shaamRetryCount,
      shaamSubmittedAt: outboundInvoices.shaamSubmittedAt,
      shaamActionCode: outboundInvoices.shaamActionCode,
      userId: outboundInvoices.userId,
    })
    .from(outboundInvoices)
    .where(scanWhere)
    // Oldest first, so a backlog drains fairly instead of leaving some
    // documents permanently unlucky in an unordered window.
    .orderBy(asc(outboundInvoices.shaamSubmittedAt));
  const rows = batchLimit > 0 ? await scan.limit(batchLimit) : await scan;

  const processed: Array<{
    documentId: string;
    outcome: string;
    detail?: string;
  }> = [];
  let budgetExhausted = false;

  for (const row of rows) {
    // Each submission is a network round trip to the ITA; stop starting
    // new ones once the run has used its budget and let the next tick
    // pick up where this one left off (the ORDER BY makes that safe).
    if (runBudgetMs > 0 && Date.now() - startedAt > runBudgetMs) {
      budgetExhausted = true;
      break;
    }

    try {
      const result = await submitDocumentToShaam({
        documentId: row.id,
        actorUserId: row.userId,
        // A reverse charge after a refusal is chased as what it was sent
        // as. Retrying it as action 1 would ask for an ordinary number on
        // a zero-VAT invoice — which the threshold rules then skip.
        actionCode: row.shaamActionCode === 3 ? 3 : 1,
      });

      // Pattern C cleanup. On APPROVED, re-render + re-archive the PDF
      // with the allocation number stamped on it (this is the bug fix
      // that the original cron path was missing entirely), then check
      // whether the seller had queued a delivery and fire it.
      const finalize = await finalizeAfterShaamClear({
        invoiceId: row.id,
        actorUserId: row.userId,
        shaamStatus: result.shaamStatus,
        allocationNumber: result.allocationNumber,
      });
      if (finalize) {
        if (!finalize.ok) {
          processed.push({
            documentId: row.id,
            outcome: "approved_finalize_failed",
            detail: finalize.error,
          });
          continue;
        }

        const autoSent = await autoSendIfQueued(row.id);
        processed.push({
          documentId: row.id,
          outcome: autoSent ? "approved_and_auto_sent" : "approved",
          detail: `${result.allocationNumber} from=${row.shaamStatus}`,
        });
        continue;
      }

      // REJECTED cancels a queued send — nothing more is coming. HELD
      // deliberately does not: it is now polled on the slow ladder above,
      // so an approval may still land, and the seller already asked for
      // the invoice to go out when it does.
      if (result.shaamStatus === "REJECTED") {
        await cancelQueuedDelivery(row.id, result.shaamStatus);
      }

      processed.push({
        documentId: row.id,
        outcome: result.shaamStatus,
        detail:
          result.allocationNumber ??
          `from=${row.shaamStatus} retries=${row.shaamRetryCount}`,
      });
    } catch (err) {
      processed.push({
        documentId: row.id,
        outcome: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Phase 2: decisions we owe the ITA -------------------------------
  //
  // Deliberately part of this cron rather than a new one. It is the same
  // job — things we owe the ITA that have not landed — and the cron lines
  // are still an unchecked launch item, so a second line is a second thing
  // that does not get installed.
  //
  // `notifyShaamDecision` is best-effort by design: the seller's choice is
  // committed locally before we ever call the ITA, so a failed
  // notification must not undo it. Without this scan those failures were
  // simply lost, which left the invoice open at the ITA exactly as if the
  // feature did not exist.
  const decisionsRetried: Array<{ documentId: string; outcome: string }> = [];
  try {
    const stuck = await findUnnotifiedDecisions(now);
    for (const row of stuck) {
      if (runBudgetMs > 0 && Date.now() - startedAt > runBudgetMs) {
        budgetExhausted = true;
        break;
      }
      const [doc] = await db
        .select({ userId: outboundInvoices.userId })
        .from(outboundInvoices)
        .where(eq(outboundInvoices.id, row.documentId))
        .limit(1);
      if (!doc) continue;

      const retry = await notifyShaamDecision({
        documentId: row.documentId,
        choice: row.choice,
        actorUserId: doc.userId,
      });
      decisionsRetried.push({
        documentId: row.documentId,
        outcome: retry.notified ? "notified" : (retry.reason ?? "failed"),
      });
    }
  } catch (err) {
    console.error(
      "[shaam-cron] decision retry phase failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const remaining = Math.max(0, eligible - rows.length);
  const limitReached = batchLimit > 0 && rows.length >= batchLimit;
  if (remaining > 0 || budgetExhausted) {
    // Loud on purpose: a backlog here means documents are waiting longer
    // on their allocation number than the ladder intends.
    console.warn(
      `[shaam-cron] backlog: eligible=${eligible} processed=${rows.length} remaining=${remaining} limitReached=${limitReached} budgetExhausted=${budgetExhausted}`,
    );
  }

  return NextResponse.json({
    eligible,
    scanned: rows.length,
    retired: retired.length,
    backlog: { remaining, limitReached, budgetExhausted },
    processed,
    decisions: decisionsRetried,
  });
}

/**
 * Read-then-claim auto-send. Snapshot the queued_delivery_* fields,
 * attempt a guarded UPDATE that clears them only if the recipient still
 * matches the snapshot, then send. The guard prevents a concurrent
 * "cancel queued send" or "force send" from racing the cron — losing
 * the WHERE comparison means the clear no-ops and we don't double-send.
 */
async function autoSendIfQueued(invoiceId: string): Promise<boolean> {
  const [snapshot] = await db
    .select({
      userId: outboundInvoices.userId,
      recipient: outboundInvoices.queuedDeliveryRecipient,
      subject: outboundInvoices.queuedDeliverySubject,
      bodyText: outboundInvoices.queuedDeliveryBodyText,
      attachCertificate: outboundInvoices.queuedDeliveryAttachCertificate,
    })
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, invoiceId))
    .limit(1);
  if (!snapshot || !snapshot.recipient || !snapshot.subject) return false;

  // Atomic claim: clear only if the recipient still matches our snapshot.
  // A parallel "cancel queued send" or "force send" would have rewritten
  // these fields; in that case the WHERE is false, the clear no-ops,
  // and we don't auto-send.
  const claim = await db
    .update(outboundInvoices)
    .set({
      queuedDeliveryRecipient: null,
      queuedDeliverySubject: null,
      queuedDeliveryBodyText: null,
      queuedDeliveryAttachCertificate: false,
      queuedDeliveryQueuedAt: null,
      queuedDeliveryQueuedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outboundInvoices.id, invoiceId),
        eq(outboundInvoices.queuedDeliveryRecipient, snapshot.recipient),
      ),
    )
    .returning({ id: outboundInvoices.id });
  if (claim.length === 0) return false;

  try {
    const caller = await callerFromUserId(snapshot.userId);
    const result = await sendOutboundInvoiceByEmailOp(caller, {
      invoiceId,
      to: snapshot.recipient,
      subject: snapshot.subject,
      body: snapshot.bodyText ?? "",
      force: true,
      attachWithholdingCertificate: snapshot.attachCertificate,
      source: "auto_after_shaam_clear",
    });
    if (!result.success) {
      console.error(
        `[shaam-cron] auto-send failed for ${invoiceId}: ${result.error}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[shaam-cron] auto-send threw for ${invoiceId}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Clear a queued delivery and write an audit-friendly note when SHAAM
 * terminates in REJECTED/HELD. The seller can resend manually after
 * fixing the data.
 */
async function cancelQueuedDelivery(
  invoiceId: string,
  shaamStatus: "REJECTED" | "HELD",
): Promise<void> {
  await db
    .update(outboundInvoices)
    .set({
      queuedDeliveryRecipient: null,
      queuedDeliverySubject: null,
      queuedDeliveryBodyText: null,
      queuedDeliveryAttachCertificate: false,
      queuedDeliveryQueuedAt: null,
      queuedDeliveryQueuedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outboundInvoices.id, invoiceId),
        isNotNull(outboundInvoices.queuedDeliveryRecipient),
      ),
    );
  console.warn(
    `[shaam-cron] queued delivery cleared for ${invoiceId} due to terminal SHAAM ${shaamStatus}`,
  );
}

export async function GET(req: NextRequest) {
  return POST(req);
}
