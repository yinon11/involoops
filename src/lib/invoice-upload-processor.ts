/**
 * Shared logic for /api/upload/process: duplicate check, extraction, DB insert.
 * Used for single files and for each entry extracted from a ZIP archive.
 */

import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import {
  mimeForExtension,
  parseZipInvoiceCandidates,
} from "@/lib/zip-invoice-candidates";
import { db } from "@/db";
import {
  invoices,
  vendors as vendorsTable,
  extractionRules,
  auditLog,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { processInvoice } from "@/lib/extraction/pipeline";
import type { VendorRule } from "@/types/vendor";
import type { LlmTokenUsage } from "@/types/invoice";
import { sanitizePostgresText } from "@/lib/utils";
import { uploadFile, buildFileKey } from "@/lib/storage";
import type { VendorInfo } from "@/lib/extraction/pipeline";
import {
  findSemanticDuplicate,
  findInvoiceNumberDuplicate,
} from "@/lib/duplicate-detector";
import {
  buildSubPdf,
  extractPerPageText,
  segmentInvoicePages,
  type InvoiceSegment,
} from "@/lib/extraction/segment-pdf";
import { resolveAnthropicApiKey } from "@/lib/user-api-key";
import { tryReserveInvoiceSlots } from "@/lib/usage";
import { AnthropicModelAccessError } from "@/lib/extraction/anthropic-models";

/**
 * Thrown by `processZipArchive` when the user's remaining monthly
 * quota cannot fit every file in the archive. Caught by the caller
 * to emit a structured 403 response — the ZIP is rejected wholesale
 * before any file is uploaded to storage or sent to the LLM.
 */
function postgresUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (
      current &&
      typeof current === "object" &&
      "code" in current &&
      String((current as { code: unknown }).code) === "23505"
    ) {
      return true;
    }
    current =
      current &&
      typeof current === "object" &&
      "cause" in current
        ? (current as { cause: unknown }).cause
        : null;
  }
  return false;
}

export class ZipExceedsPlanLimitError extends Error {
  constructor(
    public readonly requested: number,
    public readonly limit: number
  ) {
    super(
      `This ZIP contains ${requested} invoice file(s), which would exceed your monthly plan limit of ${limit}. Upload smaller batches or upgrade your plan.`
    );
    this.name = "ZipExceedsPlanLimitError";
  }
}

export interface ExtractionContext {
  vendorInfos: VendorInfo[];
  vendorRules: VendorRule[];
  /**
   * Anthropic key this upload should authenticate with. `null` means no
   * key is available (neither BYOK nor platform) — LLM steps will be
   * skipped. Resolved server-side on every upload; never trust the client.
   */
  anthropicApiKey: string | null;
}

export async function loadExtractionContext(
  userId: string
): Promise<ExtractionContext> {
  const userVendors = await db.query.vendors.findMany({
    where: eq(vendorsTable.userId, userId),
  });

  const vendorInfos = userVendors.map((v) => ({
    id: v.id,
    name: v.name,
    aliases: (v.aliases ?? []) as string[],
    isIncomeSource: v.isIncomeSource ?? false,
  }));

  const userRules = await db
    .select()
    .from(extractionRules)
    .where(eq(extractionRules.userId, userId));

  const vendorRules: VendorRule[] = userRules
    .filter((r) => r.isActive !== false)
    .map((r) => ({
      vendorId: r.vendorId ?? null,
      priority: r.priority ?? 0,
      ...(r.rules as Record<string, unknown>),
    })) as VendorRule[];

  const { key } = await resolveAnthropicApiKey(userId);

  return { vendorInfos, vendorRules, anthropicApiKey: key };
}

/** Fields returned to the upload API / client after a successful insert. */
export const uploadInvoiceReturning = {
  id: invoices.id,
  userId: invoices.userId,
  vendorId: invoices.vendorId,
  suggestedVendorName: invoices.suggestedVendorName,
  status: invoices.status,
  invoiceNumber: invoices.invoiceNumber,
  invoiceDate: invoices.invoiceDate,
  amount: invoices.amount,
  currency: invoices.currency,
  vatAmount: invoices.vatAmount,
  fileUrl: invoices.fileUrl,
  fileName: invoices.fileName,
  llmInputTokens: invoices.llmInputTokens,
  llmOutputTokens: invoices.llmOutputTokens,
  llmCostUsd: invoices.llmCostUsd,
} as const;

export type UploadedInvoiceRow = {
  id: string;
  userId: string;
  vendorId: string | null;
  suggestedVendorName: string | null;
  status: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: string;
  currency: string | null;
  vatAmount: string | null;
  fileUrl: string | null;
  fileName: string | null;
  llmInputTokens: number | null;
  llmOutputTokens: number | null;
  llmCostUsd: string | null;
};

/**
 * File must already exist in object storage at `fileKey` (hash matches buffer).
 */
export async function insertInvoiceFromUploadedBuffer(params: {
  userId: string;
  fileBuffer: Buffer;
  fileKey: string;
  fileName: string;
  vendorInfos: VendorInfo[];
  vendorRules: VendorRule[];
  /**
   * Per-user Anthropic key resolved by `loadExtractionContext`. Pass
   * through unchanged — don't re-read from env here.
   */
  anthropicApiKey: string | null;
}): Promise<
  | {
      ok: true;
      invoice: UploadedInvoiceRow;
      /**
       * Soft warning: another non-rejected invoice already uses this
       * invoice number. Returned so the upload UI can show an inline hint
       * pointing at the Duplicates page; not used to block auto-approve.
       */
      possibleDuplicateInvoiceId?: string;
    }
  | { ok: false; duplicate: true; existingInvoiceId: string }
> {
  const {
    userId,
    fileBuffer,
    fileKey,
    fileName,
    vendorInfos,
    vendorRules,
    anthropicApiKey,
  } = params;

  const fileHash = crypto
    .createHash("sha256")
    .update(fileBuffer)
    .digest("hex");

  const [existing] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(eq(invoices.userId, userId), eq(invoices.fileHash, fileHash)),
    )
    .limit(1);

  if (existing) {
    return {
      ok: false,
      duplicate: true,
      existingInvoiceId: existing.id,
    };
  }

  let result: Awaited<ReturnType<typeof processInvoice>>;
  try {
    result = await processInvoice(
      fileBuffer,
      userId,
      vendorInfos,
      vendorRules,
      anthropicApiKey
    );
  } catch (err) {
    // BYOK key cannot reach the configured extraction model — there's no
    // point silently writing an empty pending row, the user needs to fix
    // their key first. Let this propagate so the upload route surfaces a
    // clear, actionable message and the row is never created.
    if (err instanceof AnthropicModelAccessError) {
      throw err;
    }
    // When extraction fails (e.g. the file isn't a recognisable invoice),
    // create the invoice in "pending" status so the user can fix it manually
    // instead of returning an error.
    console.error("Extraction failed, creating pending invoice:", err);
    result = {
      data: {
        invoiceDate: null,
        vendorName: null,
        amount: null,
        currency: null,
        amountUsd: null,
        vatAmount: null,
        amountWithoutVat: null,
        invoiceNumber: null,
        description: null,
        expenseCategory: null,
        isFixedAsset: false,
      },
      confidence: 0,
      method: "manual" as const,
      rawText: "",
      pageCount: 0,
      matchedVendorId: null,
      extractionFailed: true,
      llmUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  }

  const vendorId: string | null = result.matchedVendorId;
  const suggestedVendorName =
    !vendorId && result.data.vendorName?.trim()
      ? sanitizePostgresText(result.data.vendorName.trim()) || null
      : null;

  // Hard-block semantic duplicate: same user + vendor + invoice number + amount +
  // invoice date on a non-rejected invoice. This catches re-uploads of the same
  // logical invoice where the file bytes differ (e.g. re-downloaded PDFs with
  // fresh metadata).
  const semanticDuplicateId = await findSemanticDuplicate({
    userId,
    vendorId,
    invoiceNumber: result.data.invoiceNumber,
    amount: result.data.amount,
    invoiceDate: result.data.invoiceDate,
  });
  if (semanticDuplicateId) {
    return {
      ok: false,
      duplicate: true,
      existingInvoiceId: semanticDuplicateId,
    };
  }

  // Soft-warn duplicate: invoice number alone matches an existing non-rejected
  // invoice. Not enough to block the upload, and no longer blocks auto-approve
  // either — the user sees these pairs on the Duplicates page.
  const possibleDuplicateInvoiceId = await findInvoiceNumberDuplicate(
    userId,
    result.data.invoiceNumber
  );

  // Look up the matched vendor's income flag so the new invoice is classified
  // as income/expense consistently with the vendor's setting.
  const matchedVendor = vendorId
    ? await db.query.vendors.findFirst({
        where: and(
          eq(vendorsTable.id, vendorId),
          eq(vendorsTable.userId, userId)
        ),
      })
    : null;

  // Trust the vendor's auto-approve flag unless extraction completely failed.
  // A failed extraction leaves all fields empty, so the invoice must go
  // through the pending queue for manual data entry.
  const shouldAutoApprove =
    !result.extractionFailed && matchedVendor?.autoApprove === true;

  const now = new Date();
  const addedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let invoice: UploadedInvoiceRow;
  try {
    [invoice] = await db
      .insert(invoices)
      .values({
        userId,
        type: matchedVendor?.isIncomeSource ? "income" : "expense",
        status: shouldAutoApprove ? "approved" : "pending",
        invoiceNumber: sanitizePostgresText(result.data.invoiceNumber ?? null),
        invoiceDate: result.data.invoiceDate,
        amount: String(result.data.amount ?? 0),
        currency: result.data.currency ?? "ILS",
        vatAmount:
          result.data.vatAmount != null ? String(result.data.vatAmount) : null,
        amountWithoutVat:
          result.data.amountWithoutVat != null
            ? String(result.data.amountWithoutVat)
            : null,
        description: sanitizePostgresText(result.data.description),
        expenseCategory: result.data.expenseCategory,
        isFixedAsset: result.data.isFixedAsset,
        fileUrl: fileKey,
        fileName: sanitizePostgresText(fileName),
        fileHash,
        pageCount: result.pageCount > 0 ? result.pageCount : null,
        extractedText: sanitizePostgresText(result.rawText),
        extractionMethod: result.method as "text" | "vision" | "manual",
        extractionConfidence: String(result.confidence),
        vendorId,
        suggestedVendorName,
        addedMonth,
        llmInputTokens: result.llmUsage.inputTokens,
        llmOutputTokens: result.llmUsage.outputTokens,
        llmCostUsd: result.llmUsage.costUsd.toFixed(6),
      })
      .returning(uploadInvoiceReturning);
  } catch (err) {
    // Two parallel intakes can both pass the pre-insert duplicate check and
    // race on the (user_id, file_hash) unique index — treat as duplicate.
    if (postgresUniqueViolation(err)) {
      const [raced] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(eq(invoices.userId, userId), eq(invoices.fileHash, fileHash)),
        )
        .limit(1);
      if (raced) {
        return {
          ok: false,
          duplicate: true,
          existingInvoiceId: raced.id,
        };
      }
    }
    throw err;
  }

  if (shouldAutoApprove && invoice) {
    const invoiceDate = result.data.invoiceDate
      ? new Date(result.data.invoiceDate)
      : new Date();
    const y = invoiceDate.getFullYear();
    const m = String(invoiceDate.getMonth() + 1).padStart(2, "0");

    await db.insert(auditLog).values({
      userId,
      invoiceId: invoice.id,
      action: "approve",
      details: {
        invoiceMonth: `${y}-${m}`,
        autoApproved: true,
        vendorName: matchedVendor?.name,
      },
    });
  }

  return {
    ok: true,
    invoice: invoice!,
    ...(possibleDuplicateInvoiceId
      ? { possibleDuplicateInvoiceId }
      : {}),
  };
}

export type ZipProcessResult = {
  invoices: UploadedInvoiceRow[];
  duplicates: { fileName: string; existingInvoiceId: string }[];
  /** Soft warnings: invoice was inserted, but its invoice number matches an existing one. */
  warnings: {
    fileName: string;
    invoiceId: string;
    existingInvoiceId: string;
  }[];
  errors: { fileName: string; error: string }[];
};

/**
 * Process every supported invoice file inside a ZIP archive.
 *
 * Plan-limit policy is **all-or-nothing**: if the archive contains
 * more files than the user's remaining monthly quota, we don't process
 * any of them — we throw `ZipExceedsPlanLimitError` and the caller
 * surfaces a structured 403. This is deliberate: extracting half a
 * batch and silently dropping the rest is a worse UX than refusing
 * the upload up-front and letting the user upgrade or split the ZIP.
 *
 * When the batch fits, all N slots are reserved atomically before any
 * S3 upload or LLM call happens. Per the global usage policy these
 * slots stay consumed even if individual files turn out to be
 * duplicates or fail extraction — every attempted handle counts.
 */
export async function processZipArchive(
  zipBuffer: Buffer,
  userId: string,
  ctx: ExtractionContext,
  planLimit: number
): Promise<ZipProcessResult> {
  const parsed = await parseZipInvoiceCandidates(zipBuffer);
  const candidates = parsed.map(({ name, data }) => ({
    name,
    buffer: Buffer.from(data),
  }));

  if (candidates.length === 0) {
    throw new Error(
      "No supported invoice files found in the ZIP (use PDF or images: PNG, JPEG, WebP, TIFF)."
    );
  }

  // Refuse the ZIP wholesale if it can't fit in the user's remaining
  // quota. This must run BEFORE any S3 upload or LLM extraction, so
  // an over-quota archive doesn't cost us money or leave half-processed
  // state behind. The reservation is atomic in Postgres, so two tabs
  // can't both see "fits" and both consume the row.
  const reserved = await tryReserveInvoiceSlots(
    userId,
    candidates.length,
    planLimit
  );
  if (!reserved) {
    throw new ZipExceedsPlanLimitError(candidates.length, planLimit);
  }

  const invoices: UploadedInvoiceRow[] = [];
  const duplicates: { fileName: string; existingInvoiceId: string }[] = [];
  const warnings: ZipProcessResult["warnings"] = [];
  const errors: { fileName: string; error: string }[] = [];

  for (const { name, buffer } of candidates) {
    try {
      const ext = name.includes(".")
        ? name.slice(name.lastIndexOf(".") + 1)
        : "pdf";
      const uniqueName = `${uuidv4()}.${ext}`;
      const key = buildFileKey(userId, uniqueName);
      await uploadFile(buffer, key, mimeForExtension(ext));

      const r = await insertInvoiceFromUploadedBuffer({
        userId,
        fileBuffer: buffer,
        fileKey: key,
        fileName: name,
        vendorInfos: ctx.vendorInfos,
        vendorRules: ctx.vendorRules,
        anthropicApiKey: ctx.anthropicApiKey,
      });

      if (!r.ok) {
        // Slot stays consumed — duplicates count toward the quota
        // because we still did the extraction work to detect them.
        duplicates.push({
          fileName: name,
          existingInvoiceId: r.existingInvoiceId,
        });
        continue;
      }
      invoices.push(r.invoice);
      if (r.possibleDuplicateInvoiceId) {
        warnings.push({
          fileName: name,
          invoiceId: r.invoice.id,
          existingInvoiceId: r.possibleDuplicateInvoiceId,
        });
      }
    } catch (e) {
      // Slot stays consumed — failed handles count too.
      errors.push({
        fileName: name,
        error: e instanceof Error ? e.message : "Processing failed",
      });
    }
  }

  return { invoices, duplicates, warnings, errors };
}

export function isZipFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".zip");
}

export interface InvoiceSplitResult {
  invoices: UploadedInvoiceRow[];
  duplicates: { fileName: string; existingInvoiceId: string }[];
  warnings: {
    fileName: string;
    invoiceId: string;
    existingInvoiceId: string;
  }[];
  errors: { fileName: string; error: string }[];
  /** Resolved segments the LLM returned (post-validation). */
  segments: InvoiceSegment[];
  /** Token cost of the Haiku segmentation call. */
  segmentationUsage: LlmTokenUsage;
}

/**
 * Split one multi-page PDF into per-invoice sub-PDFs and run each through
 * the standard upload pipeline. Shares the same return shape as
 * `processZipArchive` so the caller (Split button in pending queue) can
 * surface the batch outcome uniformly.
 *
 * Does NOT delete or modify the source invoice row — that's the caller's
 * responsibility, because the right policy (hard delete vs. reject) depends
 * on the entry point.
 */
export async function splitPdfIntoSubInvoices(params: {
  userId: string;
  sourceBuffer: Buffer;
  sourceFileName: string;
  ctx: ExtractionContext;
}): Promise<InvoiceSplitResult> {
  const { userId, sourceBuffer, sourceFileName, ctx } = params;

  const { pageCount, pages } = await extractPerPageText(sourceBuffer);

  if (pageCount <= 1) {
    throw new Error(
      "This invoice has only one page — nothing to split."
    );
  }

  const { segments, usage: segmentationUsage } = await segmentInvoicePages(
    sourceBuffer,
    pages,
    ctx.anthropicApiKey ?? undefined
  );

  if (segments.length === 0) {
    throw new Error(
      "Could not determine how to split this PDF. The segmentation model couldn't tell the pages apart — try rejecting it and re-uploading each invoice separately."
    );
  }

  // A single segment means the segmenter thinks the whole PDF is one
  // invoice. Re-running the pipeline on an identical file would just trip
  // the semantic-duplicate detector against the original and insert
  // nothing, so refuse up front with a clear message.
  if (segments.length === 1) {
    throw new Error(
      "This PDF appears to be a single invoice — nothing to split. If the current extraction looks wrong, use Re-generate instead."
    );
  }

  const insertedInvoices: UploadedInvoiceRow[] = [];
  const duplicates: InvoiceSplitResult["duplicates"] = [];
  const warnings: InvoiceSplitResult["warnings"] = [];
  const errors: InvoiceSplitResult["errors"] = [];

  // Derive a file-name stem we can append page-range suffixes to, so each
  // child invoice gets a human-readable name in listings and in the pending
  // queue header.
  const dotIdx = sourceFileName.lastIndexOf(".");
  const stem = dotIdx > 0 ? sourceFileName.slice(0, dotIdx) : sourceFileName;

  for (const segment of segments) {
    const pageRange =
      segment.pages.length === 1
        ? `p${segment.pages[0]}`
        : `p${segment.pages[0]}-${segment.pages[segment.pages.length - 1]}`;
    const segmentFileName = `${stem}-${pageRange}.pdf`;

    try {
      const subPdfBuffer = await buildSubPdf(sourceBuffer, segment.pages);
      const uniqueName = `${uuidv4()}.pdf`;
      const key = buildFileKey(userId, uniqueName);
      await uploadFile(subPdfBuffer, key, "application/pdf");

      const r = await insertInvoiceFromUploadedBuffer({
        userId,
        fileBuffer: subPdfBuffer,
        fileKey: key,
        fileName: segmentFileName,
        vendorInfos: ctx.vendorInfos,
        vendorRules: ctx.vendorRules,
        anthropicApiKey: ctx.anthropicApiKey,
      });

      if (!r.ok) {
        duplicates.push({
          fileName: segmentFileName,
          existingInvoiceId: r.existingInvoiceId,
        });
        continue;
      }
      insertedInvoices.push(r.invoice);
      if (r.possibleDuplicateInvoiceId) {
        warnings.push({
          fileName: segmentFileName,
          invoiceId: r.invoice.id,
          existingInvoiceId: r.possibleDuplicateInvoiceId,
        });
      }
    } catch (e) {
      errors.push({
        fileName: segmentFileName,
        error: e instanceof Error ? e.message : "Segment processing failed",
      });
    }
  }

  // Distribute the one-shot Haiku segmentation cost evenly across the
  // children we actually inserted, so that `sum(invoices.llmCostUsd)` over
  // this user still reflects reality. Duplicates and errors are excluded
  // because there is no DB row to attribute to. Tokens are integer-rounded;
  // the exact un-rounded numbers remain in the audit log.
  if (
    insertedInvoices.length > 0 &&
    (segmentationUsage.costUsd > 0 ||
      segmentationUsage.inputTokens > 0 ||
      segmentationUsage.outputTokens > 0)
  ) {
    const n = insertedInvoices.length;
    const shareInput = Math.floor(segmentationUsage.inputTokens / n);
    const shareOutput = Math.floor(segmentationUsage.outputTokens / n);
    const shareCost = segmentationUsage.costUsd / n;

    for (const child of insertedInvoices) {
      const updated = await db
        .update(invoices)
        .set({
          llmInputTokens: (child.llmInputTokens ?? 0) + shareInput,
          llmOutputTokens: (child.llmOutputTokens ?? 0) + shareOutput,
          llmCostUsd: sql`${invoices.llmCostUsd} + ${shareCost.toFixed(6)}`,
        })
        .where(
          and(eq(invoices.id, child.id), eq(invoices.userId, userId))
        )
        .returning({
          id: invoices.id,
          llmInputTokens: invoices.llmInputTokens,
          llmOutputTokens: invoices.llmOutputTokens,
          llmCostUsd: invoices.llmCostUsd,
        });
      // Keep the returned object in sync so the caller sees the distributed values.
      if (updated[0]) {
        const idx = insertedInvoices.indexOf(child);
        insertedInvoices[idx] = {
          ...child,
          llmInputTokens: updated[0].llmInputTokens,
          llmOutputTokens: updated[0].llmOutputTokens,
          llmCostUsd: updated[0].llmCostUsd,
        };
      }
    }
  }

  return {
    invoices: insertedInvoices,
    duplicates,
    warnings,
    errors,
    segments,
    segmentationUsage,
  };
}
