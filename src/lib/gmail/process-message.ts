/**
 * Per-message pipeline: take one Gmail message ID, run the full
 * intake decision (resolve user, verify DKIM, walk attachments,
 * run extraction, log outcome). Returns a single outcome object the
 * caller (the webhook) writes to `inbound_email_log`.
 *
 * Designed to be idempotent: callers can re-invoke with the same
 * message ID and we'll dedupe via the UNIQUE `gmail_message_id` row in
 * `inbound_email_log`. The row is claimed atomically (outcome
 * "processing") BEFORE any expensive work, so two concurrent Pub/Sub
 * deliveries of the same message can't both run the pipeline — the
 * loser of the insert race exits immediately as "duplicate". Without
 * this, the loser would re-extract the attachment, hit the file-hash
 * duplicate guard, and mail the user a spurious intake-failure alert
 * for an email that actually succeeded.
 *
 * No I/O leaks back to the caller — every error path returns an
 * outcome. Throws are reserved for "the system is broken" (e.g. DB
 * down), which the route translates to 5xx so Pub/Sub will retry.
 */

import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import {
  users,
  inboundEmailLog,
  invoices as invoicesTable,
  vendors as vendorsTable,
  authorizedSenderEmails,
} from "@/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  sendInvoiceScanConfirmation,
  type ScannedInvoiceSummary,
} from "@/lib/email/transactional";
import { isLocale } from "@/lib/i18n/config";
import {
  getMessage,
  getAttachmentBuffer,
  markMessageRead,
} from "@/lib/gmail/client";
import {
  getHeader,
  parseEmailAddress,
  parseDkimResult,
  localPartOf,
} from "@/lib/gmail/headers";
import { listAttachments, type AttachmentRef } from "@/lib/gmail/attachments";
import { pickInvoiceAttachments } from "@/lib/gmail/pick-invoice-attachment";
import {
  loadExtractionContext,
  insertInvoiceFromUploadedBuffer,
  processZipArchive,
  isZipFileName,
  ZipExceedsPlanLimitError,
} from "@/lib/invoice-upload-processor";
import { uploadFile, buildFileKey } from "@/lib/storage";
import {
  detectMimeFromBytes,
  safeExtensionFromFilename,
} from "@/lib/file-validation";
import { checkUsageLimit, tryReserveInvoiceSlot } from "@/lib/usage";
import { notifyIntakeFailure } from "@/lib/email/intake-failure-notify";

export type InboundOutcome =
  | "accepted"
  | "duplicate"
  | "unknown_sender"
  | "dkim_fail"
  | "over_limit"
  | "no_attachment"
  | "no_valid_attachment"
  | "error";

export interface ProcessResult {
  outcome: InboundOutcome;
  matchedUserId: string | null;
  invoiceIds: string[];
  errorMessage: string | null;
}

const INVOICE_DOMAIN = process.env.INVOICE_DOMAIN ?? "involoops.com";

/** Claims older than this are considered abandoned (hard crash mid-
 * pipeline) and may be re-claimed by a retry. Must comfortably exceed
 * the route's `maxDuration` (120s) so we never steal a live claim. */
const STALE_CLAIM_MINUTES = 15;

export async function processInboundMessage(
  gmailMessageId: string,
): Promise<ProcessResult> {
  // Atomic claim FIRST, before any expensive work. The UNIQUE index on
  // `gmail_message_id` makes the insert the arbiter: exactly one caller
  // gets a row back, every concurrent/later caller gets nothing and
  // bails as "duplicate". The DO UPDATE branch only fires for stale
  // "processing" rows (abandoned by a crash), letting a retry re-claim
  // them instead of the message being lost forever.
  const claimed = await db
    .insert(inboundEmailLog)
    .values({ gmailMessageId, outcome: "processing" })
    .onConflictDoUpdate({
      target: inboundEmailLog.gmailMessageId,
      set: { receivedAt: sql`now()`, outcome: "processing" },
      setWhere: sql`${inboundEmailLog.outcome} = 'processing' and ${inboundEmailLog.receivedAt} < now() - (${STALE_CLAIM_MINUTES} * interval '1 minute')`,
    })
    .returning({ id: inboundEmailLog.id });
  if (claimed.length === 0) {
    return {
      outcome: "duplicate",
      matchedUserId: null,
      invoiceIds: [],
      errorMessage: null,
    };
  }

  let message;
  try {
    message = await getMessage(gmailMessageId);
  } catch (err) {
    // Transient Gmail error — release the claim so a Pub/Sub retry can
    // reprocess the message, then surface the error to the caller.
    await db
      .delete(inboundEmailLog)
      .where(eq(inboundEmailLog.gmailMessageId, gmailMessageId));
    throw new Error(
      `Failed to fetch message ${gmailMessageId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const fromAddress = parseEmailAddress(getHeader(message, "From"));
  const toAddress = parseEmailAddress(getHeader(message, "To"));
  const subject = getHeader(message, "Subject");
  const dkimResult = parseDkimResult(
    getHeader(message, "Authentication-Results"),
  );
  const dkimPass = dkimResult === "pass";
  const inReplyToHeader = getHeader(message, "Message-ID");

  // ---- DKIM gate -----------------------------------------------------
  // Per the design decision: hard reject anything not DKIM-verified.
  // SPF intentionally not checked — forwarding always breaks SPF.
  if (!dkimPass) {
    await logAndMaybeReply({
      gmailMessageId,
      threadId: message.threadId ?? null,
      inReplyTo: inReplyToHeader,
      fromAddress,
      toAddress,
      subject,
      dkimPass,
      matchedUserId: null,
      outcome: "dkim_fail",
      invoiceIds: [],
      errorMessage: `dkim=${dkimResult}`,
    });
    await safeMarkRead(gmailMessageId);
    await notifyIntakeFailure({
      outcome: "dkim_fail",
      errorMessage: `dkim=${dkimResult}`,
      subject,
      fromAddress,
    });
    return {
      outcome: "dkim_fail",
      matchedUserId: null,
      invoiceIds: [],
      errorMessage: `dkim=${dkimResult}`,
    };
  }

  // ---- Resolve user --------------------------------------------------
  // Primary: To: <alias>@INVOICE_DOMAIN  (multi-account safe).
  // Fallback: From: matches a registered users.email.
  const matchedUserId = await resolveUser({ toAddress, fromAddress });

  if (!matchedUserId) {
    await logAndMaybeReply({
      gmailMessageId,
      threadId: message.threadId ?? null,
      inReplyTo: inReplyToHeader,
      fromAddress,
      toAddress,
      subject,
      dkimPass,
      matchedUserId: null,
      outcome: "unknown_sender",
      invoiceIds: [],
      errorMessage: null,
    });
    await safeMarkRead(gmailMessageId);
    await notifyIntakeFailure({
      outcome: "unknown_sender",
      errorMessage: null,
      subject,
      fromAddress,
    });
    return {
      outcome: "unknown_sender",
      matchedUserId: null,
      invoiceIds: [],
      errorMessage: null,
    };
  }

  // ---- Plan-limit gate ----------------------------------------------
  const usage = await checkUsageLimit(matchedUserId);
  if (!usage.allowed) {
    await logAndMaybeReply({
      gmailMessageId,
      threadId: message.threadId ?? null,
      inReplyTo: inReplyToHeader,
      fromAddress,
      toAddress,
      subject,
      dkimPass,
      matchedUserId,
      outcome: "over_limit",
      invoiceIds: [],
      errorMessage: `${usage.current}/${usage.limit} on ${usage.planName}`,
    });
    await safeMarkRead(gmailMessageId);
    await notifyIntakeFailure({
      matchedUserId,
      outcome: "over_limit",
      errorMessage: `${usage.current}/${usage.limit} on ${usage.planName}`,
      subject,
      fromAddress,
    });
    return {
      outcome: "over_limit",
      matchedUserId,
      invoiceIds: [],
      errorMessage: `${usage.current}/${usage.limit}`,
    };
  }

  // ---- Attachments ---------------------------------------------------
  const allAttachments = listAttachments(message);
  if (allAttachments.length === 0) {
    await finalizeInboundLog({
      gmailMessageId,
      fromAddress,
      toAddress,
      subject,
      dkimPass,
      matchedUserId,
      outcome: "no_attachment",
      invoiceIds: [],
      errorMessage: null,
    });
    await safeMarkRead(gmailMessageId);
    await notifyIntakeFailure({
      matchedUserId,
      outcome: "no_attachment",
      errorMessage: null,
      subject,
      fromAddress,
    });
    return {
      outcome: "no_attachment",
      matchedUserId,
      invoiceIds: [],
      errorMessage: null,
    };
  }

  // When there are multiple attachments, pick only the one most likely to be
  // the actual invoice (e.g. skip receipts, usage breakdowns, logos, etc.).
  const attachments = pickInvoiceAttachments(allAttachments);

  // ---- Extraction loop ----------------------------------------------
  const ctx = await loadExtractionContext(matchedUserId);
  const invoiceIds: string[] = [];
  const errors: string[] = [];

  for (const att of attachments) {
    try {
      const result = await processOneAttachment({
        userId: matchedUserId,
        att,
        gmailMessageId,
        ctx,
        planLimit: usage.limit,
      });
      invoiceIds.push(...result.invoiceIds);
      if (result.error) errors.push(`${att.filename}: ${result.error}`);
    } catch (err) {
      errors.push(
        `${att.filename}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  // Usage bookkeeping is done inside the attachment processor via atomic
  // reserve-before-insert, so no post-loop increment is needed here. That
  // also closes a TOCTOU gap where a burst of messages could each pass
  // the up-front `checkUsageLimit` and collectively overshoot the cap.

  const outcome: InboundOutcome =
    invoiceIds.length > 0
      ? "accepted"
      : errors.length > 0
        ? "no_valid_attachment"
        : "no_valid_attachment";

  await finalizeInboundLog({
    gmailMessageId,
    fromAddress,
    toAddress,
    subject,
    dkimPass,
    matchedUserId,
    outcome,
    invoiceIds,
    errorMessage: errors.length ? errors.join(" | ") : null,
  });
  await safeMarkRead(gmailMessageId);

  if (outcome === "accepted" && invoiceIds.length > 0) {
    await safeSendScanConfirmation({
      userId: matchedUserId,
      invoiceIds,
      subject,
    });
  } else if (outcome === "no_valid_attachment") {
    await notifyIntakeFailure({
      matchedUserId,
      outcome: "no_valid_attachment",
      errorMessage: errors.length ? errors.join(" | ") : null,
      subject,
      fromAddress,
    });
  }

  return {
    outcome,
    matchedUserId,
    invoiceIds,
    errorMessage: errors.length ? errors.join(" | ") : null,
  };
}

async function safeSendScanConfirmation(params: {
  userId: string;
  invoiceIds: string[];
  subject: string | null;
}): Promise<void> {
  try {
    const user = await db
      .select({
        email: users.email,
        name: users.name,
        preferredLocale: users.preferredLocale,
      })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    const u = user[0];
    if (!u?.email) return;

    const rows = await db
      .select({
        fileName: invoicesTable.fileName,
        invoiceNumber: invoicesTable.invoiceNumber,
        invoiceDate: invoicesTable.invoiceDate,
        amount: invoicesTable.amount,
        currency: invoicesTable.currency,
        status: invoicesTable.status,
        vendorName: vendorsTable.name,
        suggestedVendorName: invoicesTable.suggestedVendorName,
      })
      .from(invoicesTable)
      .leftJoin(vendorsTable, eq(invoicesTable.vendorId, vendorsTable.id))
      .where(inArray(invoicesTable.id, params.invoiceIds));

    if (rows.length === 0) return;

    const summaries: ScannedInvoiceSummary[] = rows.map((r) => ({
      vendorName: r.vendorName ?? r.suggestedVendorName ?? null,
      invoiceNumber: r.invoiceNumber ?? null,
      invoiceDate: r.invoiceDate ?? null,
      amount: r.amount ?? null,
      currency: r.currency ?? null,
      fileName: r.fileName ?? null,
      status: r.status ?? null,
    }));

    const locale = isLocale(u.preferredLocale) ? u.preferredLocale : "en";

    await sendInvoiceScanConfirmation({
      to: u.email,
      name: u.name,
      locale,
      subject: params.subject,
      invoices: summaries,
    });
  } catch (err) {
    // Best-effort: confirmation email failures must not break intake.
    console.error("[gmail.intake] scan confirmation email failed", err);
  }
}

async function resolveUser(params: {
  toAddress: string | null;
  fromAddress: string | null;
}): Promise<string | null> {
  // Alias path: To: <alias>@<INVOICE_DOMAIN> → users.invoice_alias.
  if (params.toAddress?.endsWith(`@${INVOICE_DOMAIN}`)) {
    const local = localPartOf(params.toAddress);
    if (local) {
      const row = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.invoiceAlias, local))
        .limit(1);
      if (row[0]?.id) return row[0].id;
    }
  }
  // Fallback: From: matches a registered email exactly (case-insensitive
  // — emails are stored lowercase already at signup, but defend anyway).
  if (params.fromAddress) {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${params.fromAddress.toLowerCase()}`)
      .limit(1);
    if (row[0]?.id) return row[0].id;

    // Fallback #2: From: matches a VERIFIED additional sender the user added
    // (Settings → Email forwarding). Ranked below the owner's own email so a
    // real account always wins — that ordering is why no signup-time check is
    // needed. See src/db/schema/authorized-sender-emails.ts.
    const authorized = await db
      .select({ ownerUserId: authorizedSenderEmails.ownerUserId })
      .from(authorizedSenderEmails)
      .where(
        and(
          sql`lower(${authorizedSenderEmails.email}) = ${params.fromAddress.toLowerCase()}`,
          isNotNull(authorizedSenderEmails.verifiedAt),
        ),
      )
      .limit(1);
    if (authorized[0]?.ownerUserId) return authorized[0].ownerUserId;
  }
  return null;
}

async function processOneAttachment(params: {
  userId: string;
  att: AttachmentRef;
  gmailMessageId: string;
  ctx: Awaited<ReturnType<typeof loadExtractionContext>>;
  planLimit: number;
}): Promise<{ invoiceIds: string[]; error: string | null }> {
  const { userId, att, gmailMessageId, ctx, planLimit } = params;

  // Hard cap — same 25MB ceiling the upload route enforces.
  const MAX_BYTES = 25 * 1024 * 1024;
  if (att.size > MAX_BYTES) {
    return {
      invoiceIds: [],
      error: `exceeds ${MAX_BYTES} bytes`,
    };
  }

  const buffer = await getAttachmentBuffer(gmailMessageId, att.attachmentId);

  if (buffer.length > MAX_BYTES) {
    return { invoiceIds: [], error: `exceeds ${MAX_BYTES} bytes (decoded)` };
  }

  // Reject by extension before doing any extraction work. ZIP is allowed
  // because the processor branches on it.
  const ext = safeExtensionFromFilename(att.filename);
  if (!ext) {
    return { invoiceIds: [], error: "unsupported extension" };
  }
  // Magic-byte check: senders can mislabel mime types. We do this on the
  // upload route too for the same reason.
  if (!detectMimeFromBytes(buffer)) {
    return { invoiceIds: [], error: "bytes do not match accepted type" };
  }

  if (isZipFileName(att.filename)) {
    try {
      const result = await processZipArchive(buffer, userId, ctx, planLimit);
      return {
        invoiceIds: result.invoices.map((i) => i.id),
        error: result.errors.length
          ? result.errors.map((e) => `${e.fileName}: ${e.error}`).join("; ")
          : null,
      };
    } catch (err) {
      // ZIP rejected wholesale because it wouldn't fit in the user's
      // remaining quota. Per the all-or-nothing policy nothing was
      // processed and no slots were consumed; surface the reason on
      // the inbound log so the user can see why the email was skipped.
      if (err instanceof ZipExceedsPlanLimitError) {
        return { invoiceIds: [], error: err.message };
      }
      throw err;
    }
  }

  // Single file: reserve the slot atomically so a burst of messages
  // can't collectively overshoot the plan cap. Per the global usage
  // policy the slot stays consumed even if the file turns out to be a
  // duplicate or extraction throws — every attempted handle counts.
  const reserved = await tryReserveInvoiceSlot(userId, planLimit);
  if (!reserved) {
    return { invoiceIds: [], error: "plan limit reached" };
  }

  const uniqueName = `${uuidv4()}.${ext}`;
  const key = buildFileKey(userId, uniqueName);
  await uploadFile(buffer, key, mimeForExt(ext));

  const result = await insertInvoiceFromUploadedBuffer({
    userId,
    fileBuffer: buffer,
    fileKey: key,
    fileName: att.filename,
    vendorInfos: ctx.vendorInfos,
    vendorRules: ctx.vendorRules,
    anthropicApiKey: ctx.anthropicApiKey,
  });

  if (!result.ok) {
    return {
      invoiceIds: [],
      error: `duplicate of invoice ${result.existingInvoiceId}`,
    };
  }
  return { invoiceIds: [result.invoice.id], error: null };
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "tiff":
    case "tif":
      return "image/tiff";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

async function safeMarkRead(messageId: string): Promise<void> {
  try {
    await markMessageRead(messageId);
  } catch (err) {
    // Best-effort. If marking fails, the message stays unread; not
    // worth retrying the whole pipeline over it.
    console.error("[gmail.intake] markMessageRead failed", err);
  }
}

interface LogParams {
  gmailMessageId: string;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string | null;
  dkimPass: boolean;
  matchedUserId: string | null;
  outcome: InboundOutcome;
  invoiceIds: string[];
  errorMessage: string | null;
}

/**
 * Fill in the row claimed at the top of {@link processInboundMessage}
 * with the final outcome. The row is keyed by the UNIQUE
 * `gmail_message_id`, and only the claim winner reaches this point.
 */
async function finalizeInboundLog(p: LogParams): Promise<void> {
  await db
    .update(inboundEmailLog)
    .set({
      fromAddress: p.fromAddress,
      toAddress: p.toAddress,
      subject: p.subject,
      dkimPass: p.dkimPass,
      matchedUserId: p.matchedUserId,
      outcome: p.outcome,
      errorMessage: p.errorMessage,
      invoiceIds: p.invoiceIds,
    })
    .where(eq(inboundEmailLog.gmailMessageId, p.gmailMessageId));
}

/**
 * Finalize the inbound log row. Sender/owner failure emails are sent via
 * {@link notifyIntakeFailure} at each rejection path in the pipeline.
 */
async function logAndMaybeReply(
  p: LogParams & { threadId: string | null; inReplyTo: string | null },
): Promise<void> {
  await finalizeInboundLog(p);
}

