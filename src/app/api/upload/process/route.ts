import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { downloadFile, deleteFile } from "@/lib/storage";
import {
  loadExtractionContext,
  insertInvoiceFromUploadedBuffer,
  processZipArchive,
  isZipFileName,
  ZipExceedsPlanLimitError,
} from "@/lib/invoice-upload-processor";
import { AnthropicModelAccessError } from "@/lib/extraction/anthropic-models";
import { checkUsageLimit, tryReserveInvoiceSlot } from "@/lib/usage";
import { onFunnelEvent } from "@/lib/email/funnel-event-service";
import { FunnelEvents } from "@/lib/email/funnel-constants";
import { db } from "@/db";
import { invoices as invoicesTable, vendors } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  detectMimeFromBytes,
  safeExtensionFromFilename,
} from "@/lib/file-validation";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isPostgresMissingColumn } from "@/lib/postgres-errors";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // match serverActions.bodySizeLimit

type InvoiceRow = typeof invoicesTable.$inferSelect;

async function resolveVendorDisplayName(
  invoice: Pick<InvoiceRow, "vendorId" | "suggestedVendorName">,
): Promise<string | null> {
  if (invoice.vendorId) {
    const row = await db.query.vendors.findFirst({
      where: eq(vendors.id, invoice.vendorId),
      columns: { name: true },
    });
    if (row?.name?.trim()) return row.name.trim();
  }
  const s = invoice.suggestedVendorName?.trim();
  return s || null;
}

// Vision-based extraction (Claude API) can take over 30s for complex files.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Hard cap per-user process calls to contain LLM/cost abuse — this is the
  // expensive endpoint (S3 download + Anthropic). The usage plan limit is a
  // monthly business cap; this is the per-minute floodgate.
  const limited = await enforceRateLimit(`process:${userId}`, 30, 60);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = parsed as { fileKey?: unknown; fileName?: unknown };
  const fileKey = typeof body.fileKey === "string" ? body.fileKey : null;
  const fileName = typeof body.fileName === "string" ? body.fileName : null;

  if (!fileKey || !fileName) {
    return NextResponse.json(
      { error: "fileKey and fileName are required" },
      { status: 400 }
    );
  }

  // Authorization: a client may only process keys under its own prefix.
  // Without this a logged-in user could instruct the server to download and
  // process any other user's object from S3 if they knew the key.
  if (!fileKey.startsWith(`${userId}/`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Reject filenames with disallowed extensions before we download a byte.
  // ZIP is accepted here because the processor branches on ZIPs below.
  const ext = safeExtensionFromFilename(fileName);
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported file extension" },
      { status: 400 }
    );
  }

  // Check usage limit before processing
  const usage = await checkUsageLimit(userId);
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "Monthly invoice limit reached",
        current: usage.current,
        limit: usage.limit,
        planName: usage.planName,
      },
      { status: 403 }
    );
  }

  // Default: drop the uploaded object from storage when this request
  // ends. Only the single-file success path keeps it (the invoice row
  // references `fileKey` as its `fileUrl`). ZIPs are consumed by
  // extraction and never referenced again; every rejection path
  // (oversize, mime-mismatch, quota, duplicate, throw) leaves an
  // orphan otherwise.
  let keepFile = false;

  try {
    const fileBuffer = await downloadFile(fileKey);

    if (fileBuffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "File exceeds maximum allowed size" },
        { status: 413 }
      );
    }

    // Magic-byte validation: the presigned URL had a client-declared
    // Content-Type but S3 never actually verified the bytes. An attacker can
    // PUT any bytes they want under their declared mime. Enforce it here.
    const detected = detectMimeFromBytes(fileBuffer);
    if (!detected) {
      return NextResponse.json(
        { error: "File contents do not match an accepted type" },
        { status: 415 }
      );
    }

    const ctx = await loadExtractionContext(userId);

    if (isZipFileName(fileName)) {
      try {
        const { invoices, duplicates, warnings, errors } =
          await processZipArchive(fileBuffer, userId, ctx, usage.limit);

        // Fire funnel events for milestones
        await fireMilestoneEvents(userId, invoices.length);

        return NextResponse.json({
          batch: true,
          invoices,
          duplicates,
          warnings,
          errors,
          planLimit: usage.limit,
          planName: usage.planName,
        });
      } catch (e) {
        if (e instanceof ZipExceedsPlanLimitError) {
          return NextResponse.json(
            {
              error: e.message,
              requested: e.requested,
              current: usage.current,
              limit: e.limit,
              planName: usage.planName,
            },
            { status: 403 }
          );
        }
        const message =
          e instanceof Error ? e.message : "Invalid or empty ZIP archive";
        const isNoFiles = message.includes("No supported invoice files");
        return NextResponse.json(
          { error: message },
          { status: isNoFiles ? 400 : 422 }
        );
      }
    }

    // Single-file path: reserve the slot atomically before doing any work.
    // Closes the TOCTOU gap where two concurrent uploads (e.g. two tabs)
    // both pass the up-front `checkUsageLimit` and both insert, exceeding
    // the plan cap. The reservation is monotonic — duplicates and failed
    // extractions still consume the slot, because the work was attempted.
    const reserved = await tryReserveInvoiceSlot(userId, usage.limit);
    if (!reserved) {
      return NextResponse.json(
        {
          error: "Monthly invoice limit reached",
          current: usage.current,
          limit: usage.limit,
          planName: usage.planName,
        },
        { status: 403 }
      );
    }

    const result = await insertInvoiceFromUploadedBuffer({
      userId,
      fileBuffer,
      fileKey,
      fileName,
      vendorInfos: ctx.vendorInfos,
      vendorRules: ctx.vendorRules,
      anthropicApiKey: ctx.anthropicApiKey,
    });

    if (!result.ok) {
      // Duplicate detection (hash or semantic) — the existing invoice
      // already has its own stored file under a different key. Drop
      // this re-upload so we don't end up with two copies of the same
      // bytes in storage.
      return NextResponse.json(
        {
          error: "Duplicate file detected",
          existingInvoiceId: result.existingInvoiceId,
        },
        { status: 409 }
      );
    }

    // Fire funnel events for milestones
    await fireMilestoneEvents(userId, 1);

    const vendorDisplayName = await resolveVendorDisplayName(result.invoice);

    // Single-file success: the invoice row points at `fileKey`, so the
    // object must stay. This is the ONLY exit that keeps it.
    keepFile = true;

    return NextResponse.json({
      invoice: result.invoice,
      vendorDisplayName,
      ...(result.possibleDuplicateInvoiceId
        ? { possibleDuplicateInvoiceId: result.possibleDuplicateInvoiceId }
        : {}),
    });
  } catch (error) {
    if (error instanceof AnthropicModelAccessError) {
      // Surface the actionable BYOK message to the user instead of the
      // generic 500 — they need to fix their key in Settings, not retry.
      console.error(
        "[upload.process] Anthropic model access error:",
        error.message
      );
      return NextResponse.json(
        { error: error.message, code: "anthropic_model_access" },
        { status: 422 }
      );
    }
    if (isPostgresMissingColumn(error)) {
      console.error("[upload.process] DB schema mismatch:", error);
      return NextResponse.json(
        {
          error:
            "Upload is temporarily unavailable while the server is being updated. Please try again in a few minutes.",
          code: "server_schema_mismatch",
        },
        { status: 503 },
      );
    }
    console.error("Processing failed:", error);
    return NextResponse.json(
      {
        error:
          "We couldn't process this file. It may still be saved — check Pending, or try again.",
        code: "process_failed",
      },
      { status: 500 },
    );
  } finally {
    if (!keepFile) {
      try {
        await deleteFile(fileKey);
      } catch (delErr) {
        // Best-effort cleanup. The response has already been
        // determined; swallow the error so a transient S3 hiccup
        // doesn't mask it. The orphan can be reaped by a janitor.
        console.error(
          "[upload.process] failed to delete uploaded object",
          fileKey,
          delErr
        );
      }
    }
  }
}

/**
 * Fire funnel events based on invoice count milestones.
 */
async function fireMilestoneEvents(
  userId: string,
  justAdded: number,
): Promise<void> {
  try {
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoicesTable)
      .where(eq(invoicesTable.userId, userId));

    const totalCount = countResult?.count ?? 0;

    // First invoice uploaded
    if (totalCount === justAdded) {
      await onFunnelEvent(userId, FunnelEvents.FIRST_INVOICE_UPLOADED);
    }

    // 10th invoice — check approaching limit
    if (totalCount >= 10 && totalCount - justAdded < 10) {
      await onFunnelEvent(userId, FunnelEvents.TENTH_INVOICE_UPLOADED);
    }

    // Check usage limit for funnel events. Both branches use a "first-cross"
    // guard (`current - justAdded < threshold`) so the event fires once on
    // the upload that actually crossed the line, not on every subsequent
    // at-cap upload. Without the guard on PLAN_LIMIT_REACHED, a parallel
    // batch (e.g. 17 single-file uploads from one drag-and-drop, last few
    // landing within milliseconds of each other) fires the event multiple
    // times in parallel; combined with `enterFunnel`'s read-then-write that
    // produced two state rows for the same funnel and a duplicate send.
    const usage = await checkUsageLimit(userId);
    if (usage.current >= usage.limit * 0.8 && usage.current - justAdded < usage.limit * 0.8) {
      await onFunnelEvent(userId, FunnelEvents.PLAN_LIMIT_APPROACHING);
    }
    if (usage.current >= usage.limit && usage.current - justAdded < usage.limit) {
      await onFunnelEvent(userId, FunnelEvents.PLAN_LIMIT_REACHED);
    }
  } catch (err) {
    console.error("[FunnelMilestone] Error:", err);
  }
}
