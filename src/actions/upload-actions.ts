"use server";

import { db } from "@/db";
import { invoices, vendors, extractionRules, auditLog } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, isNull } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { generateFileHash } from "@/lib/duplicate-detector";
import { processInvoice } from "@/lib/extraction/pipeline";
import { checkUsageLimit, tryReserveInvoiceSlot } from "@/lib/usage";
import { resolveAnthropicApiKey } from "@/lib/user-api-key";
import { sanitizePostgresText } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import {
  deleteFile as deleteStorageFile,
  downloadFile as downloadStorageFile,
} from "@/lib/storage";
import { resolveStorageKeyFromFileUrl } from "@/lib/storage-key";
import {
  loadExtractionContext,
  splitPdfIntoSubInvoices,
} from "@/lib/invoice-upload-processor";
import { getS3ServerClient } from "@/lib/s3-clients";
import type { ActionResultWith } from "@/types/action-result";
import { getDictionary } from "@/lib/i18n/server";

const BUCKET = process.env.S3_BUCKET!;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

async function downloadFromS3(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await getS3ServerClient().send(command);
  const stream = response.Body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// processUploadedFile
// ---------------------------------------------------------------------------

export async function processUploadedFile(
  fileKey: string,
  fileName: string
) {
  const userId = await requireUserId();

  // 1. Download file from S3
  const fileBuffer = await downloadFromS3(fileKey);

  // 2. Generate file hash
  const fileHash = generateFileHash(fileBuffer);

  // 3. Check for duplicate (same hash for same user)
  const existingInvoice = await db.query.invoices.findFirst({
    where: and(
      eq(invoices.userId, userId),
      eq(invoices.fileHash, fileHash)
    ),
  });

  if (existingInvoice) {
    throw new Error(
      `Duplicate file detected. This file matches invoice ${existingInvoice.invoiceNumber ?? existingInvoice.id}.`
    );
  }

  // 4. Load user's vendors and extraction rules for the pipeline
  const userVendors = await db.query.vendors.findMany({
    where: eq(vendors.userId, userId),
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

  const vendorRules = userRules
    .filter((r) => r.isActive !== false)
    .map((r) => ({
      vendorId: r.vendorId ?? null,
      priority: r.priority ?? 0,
      ...(r.rules as Record<string, unknown>),
    })) as Parameters<typeof processInvoice>[3];

  // 5. Run extraction pipeline (BYOK key resolved server-side)
  const { key: anthropicApiKey } = await resolveAnthropicApiKey(userId);
  const extraction = await processInvoice(
    fileBuffer,
    userId,
    vendorInfos,
    vendorRules,
    anthropicApiKey
  );

  const vendorId: string | null = extraction.matchedVendorId;
  const suggestedVendorName =
    !vendorId && extraction.data.vendorName?.trim()
      ? sanitizePostgresText(extraction.data.vendorName.trim()) || null
      : null;

  // 6b. Check if matched vendor has auto-approve enabled. A completely
  // failed extraction leaves every field empty, so force pending — the
  // user has to enter the data manually.
  const matchedVendor = vendorId
    ? userVendors.find((v) => v.id === vendorId)
    : null;
  const shouldAutoApprove =
    !extraction.extractionFailed && matchedVendor?.autoApprove === true;

  // 7. Create invoice record
  const fileUrl = `https://${BUCKET}.s3.amazonaws.com/${fileKey}`;

  const [invoice] = await db
    .insert(invoices)
    .values({
      userId,
      vendorId,
      type: matchedVendor?.isIncomeSource ? "income" : "expense",
      status: shouldAutoApprove ? "approved" : "pending",
      invoiceNumber: sanitizePostgresText(extraction.data.invoiceNumber ?? null),
      invoiceDate: extraction.data.invoiceDate,
      amount: extraction.data.amount?.toString() ?? "0",
      currency: extraction.data.currency ?? "ILS",
      vatAmount: extraction.data.vatAmount?.toString() ?? null,
      amountWithoutVat: extraction.data.amountWithoutVat?.toString() ?? null,
      description: sanitizePostgresText(extraction.data.description),
      expenseCategory: extraction.data.expenseCategory,
      isFixedAsset: extraction.data.isFixedAsset,
      fileUrl,
      fileName: sanitizePostgresText(fileName) ?? fileName,
      fileHash,
      pageCount: extraction.pageCount > 0 ? extraction.pageCount : null,
      extractedText: sanitizePostgresText(extraction.rawText),
      extractionMethod: extraction.method,
      extractionConfidence: extraction.confidence.toString(),
      suggestedVendorName,
    })
    .returning();

  // 8. If auto-approved, record in audit log
  if (shouldAutoApprove) {
    const invoiceDate = extraction.data.invoiceDate
      ? new Date(extraction.data.invoiceDate)
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

  return invoice;
}

// ---------------------------------------------------------------------------
// regeneratePendingInvoices
// ---------------------------------------------------------------------------

export type RegeneratePendingFilters = {
  vendorId?: string;
  unlinkedVendorOnly?: boolean;
};

export async function regeneratePendingInvoices(
  filters?: RegeneratePendingFilters,
) {
  const userId = await requireUserId();

  const wherePending = [eq(invoices.userId, userId), eq(invoices.status, "pending")];
  if (filters?.unlinkedVendorOnly) {
    wherePending.push(isNull(invoices.vendorId));
  } else if (filters?.vendorId) {
    wherePending.push(eq(invoices.vendorId, filters.vendorId));
  }

  // 1. Fetch pending invoices (optionally scoped to current /pending filters)
  const pendingInvoices = await db
    .select()
    .from(invoices)
    .where(and(...wherePending));

  if (pendingInvoices.length === 0) {
    return { success: true, regenerated: 0 };
  }

  // 2. Load user's vendors and extraction rules once
  const userVendors = await db.query.vendors.findMany({
    where: eq(vendors.userId, userId),
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

  const vendorRulesData = userRules.map((r) => ({
    vendorId: r.vendorId!,
    ...(r.rules as Record<string, unknown>),
  })) as Parameters<typeof processInvoice>[3];

  // BYOK key resolved once, reused for every regeneration call below.
  const { key: anthropicApiKey } = await resolveAnthropicApiKey(userId);

  // Resolve the plan limit once. Each regeneration is a fresh LLM
  // handle and must atomically reserve a slot before doing the work,
  // because the counter is gated AND monotonic — once we reserve we
  // don't refund, even on failure.
  const usage = await checkUsageLimit(userId);

  // 3. Re-process each pending invoice
  let regenerated = 0;
  let limitReached = false;

  for (const inv of pendingInvoices) {
    if (!inv.fileUrl) continue;

    // Stop the batch as soon as the user runs out of monthly slots.
    // Every reservation past this point would also fail (the counter
    // never goes down inside one request), so don't keep poking the DB.
    const reserved = await tryReserveInvoiceSlot(userId, usage.limit);
    if (!reserved) {
      limitReached = true;
      break;
    }

    try {
      const fileKey = resolveStorageKeyFromFileUrl(inv.fileUrl);
      if (!fileKey) continue;

      const fileBuffer = await downloadStorageFile(fileKey);

      const extraction = await processInvoice(
        fileBuffer,
        userId,
        vendorInfos,
        vendorRulesData,
        anthropicApiKey
      );

      // Match or find vendor
      let vendorId: string | null = extraction.matchedVendorId;

      if (!vendorId && extraction.data.vendorName) {
        const existingVendor = await db.query.vendors.findFirst({
          where: and(
            eq(vendors.userId, userId),
            eq(vendors.name, extraction.data.vendorName)
          ),
        });

        if (existingVendor) {
          vendorId = existingVendor.id;
        } else {
          const [newVendor] = await db
            .insert(vendors)
            .values({
              userId,
              name: extraction.data.vendorName,
              aliases: [],
            })
            .returning();

          vendorId = newVendor.id;
        }
      }

      const matchedVendor = vendorId
        ? userVendors.find((v) => v.id === vendorId)
        : null;
      const suggestedVendorName =
        !vendorId && extraction.data.vendorName?.trim()
          ? sanitizePostgresText(extraction.data.vendorName.trim()) || null
          : null;

      // Update the invoice with new extraction data
      await db
        .update(invoices)
        .set({
          vendorId,
          type: matchedVendor?.isIncomeSource ? "income" : "expense",
          suggestedVendorName,
          invoiceNumber: extraction.data.invoiceNumber,
          invoiceDate: extraction.data.invoiceDate,
          amount: extraction.data.amount?.toString() ?? "0",
          currency: extraction.data.currency ?? "ILS",
          vatAmount: extraction.data.vatAmount?.toString() ?? null,
          amountWithoutVat:
            extraction.data.amountWithoutVat?.toString() ?? null,
          description: extraction.data.description,
          expenseCategory: extraction.data.expenseCategory,
          isFixedAsset: extraction.data.isFixedAsset,
          // Re-extract resets the sync flag so the user gets the prompt again
          // when the new classification flips an old invoice into an asset.
          fixedAssetSynced: false,
          pageCount: extraction.pageCount > 0 ? extraction.pageCount : null,
          extractedText: extraction.rawText,
          extractionMethod: extraction.method,
          extractionConfidence: extraction.confidence.toString(),
          llmInputTokens: extraction.llmUsage.inputTokens,
          llmOutputTokens: extraction.llmUsage.outputTokens,
          llmCostUsd: extraction.llmUsage.costUsd.toFixed(6),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, inv.id));

      // The handling slot was already reserved atomically before the
      // extraction call above — no post-hoc increment needed. The slot
      // stays consumed even if the work below throws, because the LLM
      // call has already incurred cost.

      regenerated++;
    } catch (error) {
      console.error(
        `Failed to regenerate invoice ${inv.id}:`,
        error
      );
    }
  }

  return { success: true, regenerated, limitReached };
}

// ---------------------------------------------------------------------------
// splitPendingInvoice
// ---------------------------------------------------------------------------

export interface SplitPendingInvoiceResult {
  invoiceIds: string[];
  segments: { pages: number[]; hint: string | null }[];
  duplicates: number;
  warnings: number;
  errors: { fileName: string; error: string }[];
  segmentationCostUsd: number;
}

/**
 * Split a pending invoice whose uploaded PDF actually contains multiple
 * distinct invoices. Runs Haiku segmentation, builds a sub-PDF per segment,
 * feeds each through the normal upload pipeline, then HARD-DELETES the
 * original invoice and its stored file.
 *
 * Only the original invoice's owner may trigger this. Refuses to run on:
 *   - non-pending invoices (approved/rejected are protected state)
 *   - invoices with no attached file
 *   - single-page PDFs (nothing to split)
 *
 * If zero child invoices were successfully inserted, the original is kept
 * and the call throws so the user can retry or reject manually.
 */
export async function splitPendingInvoice(
  invoiceId: string
): Promise<ActionResultWith<SplitPendingInvoiceResult>> {
  const dict = await getDictionary();
  const userId = await requireUserId();

  const row = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)),
  });
  if (!row) {
    throw new Error("Invoice not found");
  }
  if (row.status !== "pending") {
    return {
      success: false,
      error: dict.errors.onlyPendingCanSplit,
    };
  }
  if (!row.fileUrl?.trim()) {
    return {
      success: false,
      error: dict.errors.noFileAttached,
    };
  }

  const key = resolveStorageKeyFromFileUrl(row.fileUrl);
  if (!key) {
    throw new Error("Could not resolve storage key for this file");
  }

  // Use the storage.ts client (S3_* env vars) — matches what the upload
  // pipeline writes with, unlike the legacy downloadFromS3 helper above
  // which uses AWS_* env vars.
  const fileBuffer = await downloadStorageFile(key);

  const ctx = await loadExtractionContext(userId);

  const result = await splitPdfIntoSubInvoices({
    userId,
    sourceBuffer: fileBuffer,
    sourceFileName: row.fileName ?? `invoice-${invoiceId}.pdf`,
    ctx,
  });

  if (result.invoices.length === 0) {
    // Keep the original so the user can try again / inspect / reject manually.
    const errorDetails =
      result.errors.length > 0
        ? ` (errors: ${result.errors.map((e) => e.error).join("; ")})`
        : result.duplicates.length > 0
          ? " — every segment was detected as a duplicate of an existing invoice"
          : "";
    return {
      success: false,
      error: `Split produced no new invoices. Original invoice kept.${errorDetails}`,
    };
  }

  // Audit the split before we wipe the row — the log reference becomes a
  // dangling invoiceId after the delete, but that's intentional: we want a
  // record that this invoice existed and was replaced by N others.
  await db.insert(auditLog).values({
    userId,
    invoiceId,
    action: "split",
    details: {
      childInvoiceIds: result.invoices.map((i) => i.id),
      segments: result.segments,
      segmentationCostUsd: result.segmentationUsage.costUsd,
      duplicatesSkipped: result.duplicates.length,
      errors: result.errors,
    },
  });

  // Hard-delete the original invoice + file. Child invoices live under new
  // keys built by splitPdfIntoSubInvoices, so deleting this key is safe.
  await deleteStorageFile(key);
  await db
    .delete(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)));

  revalidatePath("/pending");
  revalidatePath("/invoices");
  revalidatePath("/money-out");
  revalidatePath(`/invoices/${invoiceId}`);

  return {
    success: true as const,
    invoiceIds: result.invoices.map((i) => i.id),
    segments: result.segments,
    duplicates: result.duplicates.length,
    warnings: result.warnings.length,
    errors: result.errors,
    segmentationCostUsd: result.segmentationUsage.costUsd,
  };
}
