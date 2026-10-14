/**
 * POST /api/webhooks/gmail
 *
 * Cloud Pub/Sub push endpoint for Gmail watch() notifications.
 *
 * Lifecycle of one delivery:
 *   1. Verify the OIDC bearer token Pub/Sub attached → reject 401 on
 *      bad signature / wrong audience.
 *   2. Decode the base64 inner payload → {emailAddress, historyId}.
 *   3. Confirm the notification is for OUR mailbox (config drift guard).
 *   4. Read our last checkpoint, call history.list since then.
 *   5. For each new message, run the per-message pipeline. Each step
 *      logs to inbound_email_log with a UNIQUE-keyed dedup guard, so
 *      Pub/Sub retries are idempotent.
 *   6. Update the checkpoint to the latest historyId we saw.
 *   7. 200 OK to ack the delivery.
 *
 * Errors:
 *   - 401 = bad / missing JWT (Pub/Sub will retry forever — that's fine,
 *     it means an attacker is hitting us, OR our audience is misconfigured).
 *   - 400 = malformed body. We still 200 here in practice because the
 *     same malformed body will keep arriving and clog retries; we log
 *     and ack.
 *   - 5xx = transient backend issue (DB down, Gmail API blip). Pub/Sub
 *     retries with exponential backoff, which is what we want.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { inboundEmailLog } from "@/db/schema";
import {
  verifyPubSubJwt,
  decodeGmailPush,
} from "@/lib/gmail/pubsub-verify";
import { listHistorySince, getInboxAddress } from "@/lib/gmail/client";
import { processInboundMessage } from "@/lib/gmail/process-message";
import {
  getWatchState,
  upsertWatchState,
} from "@/lib/gmail/watch-state";
import { renewWatchIfExpiring } from "@/lib/gmail/renew";

// Synchronous extraction can take a while on multi-attachment mails. The
// upload route uses 120s for the same reason.
export const maxDuration = 120;
// Force dynamic so middleware/cache don't intercept the push.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // ---- 1. Verify Pub/Sub JWT -----------------------------------------
  const audience = process.env.GMAIL_PUBSUB_AUDIENCE;
  if (!audience) {
    console.error("[gmail.webhook] GMAIL_PUBSUB_AUDIENCE not configured");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer" }, { status: 401 });
  }
  try {
    await verifyPubSubJwt(authHeader.slice(7), audience);
  } catch (err) {
    console.warn(
      "[gmail.webhook] JWT verification failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // ---- 2. Decode body ------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: "non-json body" });
  }
  const payload = decodeGmailPush(body);
  if (!payload) {
    console.warn("[gmail.webhook] Push body did not match expected shape");
    // 200 so Pub/Sub doesn't retry forever on a body it'll never accept.
    return NextResponse.json({ ok: true, ignored: "malformed payload" });
  }

  // ---- 3. Mailbox guard ----------------------------------------------
  const ourInbox = getInboxAddress();
  if (payload.emailAddress.toLowerCase() !== ourInbox.toLowerCase()) {
    console.warn(
      `[gmail.webhook] Push for ${payload.emailAddress}, we serve ${ourInbox}`,
    );
    return NextResponse.json({ ok: true, ignored: "wrong mailbox" });
  }

  // ---- 4. History list since checkpoint ------------------------------
  const state = await getWatchState(ourInbox);

  // First push after registration: we don't have a previous historyId
  // because watch() returned the same one Pub/Sub now sends. Use the
  // pushed historyId as the floor — we'll catch the next push from
  // here on. Means we MIGHT miss the first message that triggered
  // registration; that's expected and documented in the registration
  // script.
  if (!state?.lastHistoryId) {
    await upsertWatchState({
      mailboxEmail: ourInbox,
      lastHistoryId: payload.historyId,
    });
    return NextResponse.json({ ok: true, initialised: true });
  }

  let messageIds: string[];
  let latestHistoryId: string | null;
  try {
    const result = await listHistorySince(state.lastHistoryId);
    messageIds = result.messageIds;
    latestHistoryId = result.latestHistoryId;
  } catch (err) {
    console.error("[gmail.webhook] history.list failed", err);
    // 5xx → Pub/Sub retries.
    return NextResponse.json({ error: "Gmail API error" }, { status: 502 });
  }

  // ---- 5. Process each new message ----------------------------------
  // Sequential: extraction is LLM-bound and we don't want to detonate
  // the per-user rate limiter or Anthropic concurrency by fanning out.
  const results: Array<{ messageId: string; outcome: string }> = [];
  for (const messageId of messageIds) {
    try {
      const r = await processInboundMessage(messageId);
      results.push({ messageId, outcome: r.outcome });
    } catch (err) {
      // Per-message hard error (DB down, Gmail blip). Log the row as
      // 'error' so we have a record, then continue with the rest. The
      // checkpoint advances regardless to avoid getting stuck on one
      // poisoned message.
      console.error(
        `[gmail.webhook] processing ${messageId} failed`,
        err,
      );
      try {
        const errorMessage =
          err instanceof Error ? err.message : "unknown error";
        // A throw after the pipeline claimed its row leaves it in
        // "processing" — finalize it as an error. Guarded on outcome so
        // we never clobber a completed row from a concurrent delivery.
        const updated = await db
          .update(inboundEmailLog)
          .set({ outcome: "error", errorMessage })
          .where(
            and(
              eq(inboundEmailLog.gmailMessageId, messageId),
              eq(inboundEmailLog.outcome, "processing"),
            ),
          )
          .returning({ id: inboundEmailLog.id });
        // No claimed row (e.g. the pipeline released it after a failed
        // Gmail fetch): insert an error row so we keep a record.
        if (updated.length === 0) {
          await db
            .insert(inboundEmailLog)
            .values({
              gmailMessageId: messageId,
              outcome: "error",
              errorMessage,
            })
            .onConflictDoNothing({ target: inboundEmailLog.gmailMessageId });
        }
      } catch (logErr) {
        console.error(
          "[gmail.webhook] failed to log error row",
          logErr,
        );
      }
      results.push({ messageId, outcome: "error" });
    }
  }

  // ---- 6. Advance checkpoint ----------------------------------------
  // Use the latest historyId from the list response (guaranteed >=
  // lastHistoryId). Falling back to the push's historyId is safe
  // because Gmail guarantees historyIds are monotonically increasing
  // per mailbox.
  const nextCheckpoint = latestHistoryId ?? payload.historyId;
  await upsertWatchState({
    mailboxEmail: ourInbox,
    lastHistoryId: nextCheckpoint,
  });

  // ---- 7. Opportunistic watch renewal --------------------------------
  // We skipped the cron, so this + the startup hook are what keep the
  // watch() subscription alive. Best-effort: any failure is logged and
  // swallowed so it doesn't fail the Pub/Sub ack.
  const renewResult = await renewWatchIfExpiring();
  if (renewResult.action === "renewed" || renewResult.action === "error") {
    console.log("[gmail.webhook] renewal check:", renewResult);
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
    renewal: renewResult.action,
  });
}
