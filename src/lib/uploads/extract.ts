/**
 * Caller-parameterized extraction op for the public API's async queue.
 *
 * Mirrors the inline path in `src/actions/upload-actions.ts::processUploadedFile`
 * but takes `userId` explicitly (no session) so it can be driven by a cron
 * worker that authenticated via CRON_SECRET. Compliance invariants
 * (duplicate check, BYOK key resolution, audit log on auto-approve) are
 * preserved — this is the same business logic, not a parallel one.
 */

import { db } from "@/db";
import { invoices, vendors, extractionRules, auditLog } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { generateFileHash } from "@/lib/duplicate-detector";
import { processInvoice } from "@/lib/extraction/pipeline";
import { resolveAnthropicApiKey } from "@/lib/user-api-key";
import { sanitizePostgresText } from "@/lib/utils";
import { downloadFile } from "@/lib/storage";

export class DuplicateFileError extends Error {
  readonly code = "duplicate_file";
  constructor(
    message: string,
    readonly existingInvoiceId: string,
  ) {
    super(message);
  }
}

export interface ExtractAndInsertInput {
  userId: string;
  fileKey: string;
  fileName: string;
}

export interface ExtractAndInsertResult {
  invoiceId: string;
  autoApproved: boolean;
  confidence: number;
}

/**
 * Run the extraction pipeline against an already-uploaded S3 object and
 * insert the resulting `invoices` row. Throws `DuplicateFileError` when
 * another invoice with the same content hash already exists for this
 * user (so the caller can mark the job and surface a clean error).
 */
export async function extractAndInsert(
  input: ExtractAndInsertInput,
): Promise<ExtractAndInsertResult> {
  const { userId, fileKey, fileName } = input;

  const fileBuffer = await downloadFile(fileKey);
  const fileHash = generateFileHash(fileBuffer);

  const existingInvoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.userId, userId), eq(invoices.fileHash, fileHash)),
  });
  if (existingInvoice) {
    throw new DuplicateFileError(
      `Duplicate file detected (matches invoice ${existingInvoice.invoiceNumber ?? existingInvoice.id}).`,
      existingInvoice.id,
    );
  }

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

  const { key: anthropicApiKey } = await resolveAnthropicApiKey(userId);
  const extraction = await processInvoice(
    fileBuffer,
    userId,
    vendorInfos,
    vendorRules,
    anthropicApiKey,
  );

  const vendorId: string | null = extraction.matchedVendorId;
  const matchedVendor = vendorId
    ? userVendors.find((v) => v.id === vendorId) ?? null
    : null;
  const suggestedVendorName =
    !vendorId && extraction.data.vendorName?.trim()
      ? sanitizePostgresText(extraction.data.vendorName.trim()) || null
      : null;
  // Trust auto-approve unless extraction blew up — a crashed extraction
  // leaves every field null and the invoice must go through pending so
  // the user can fill it in.
  const shouldAutoApprove =
    !extraction.extractionFailed && matchedVendor?.autoApprove === true;

  const bucket = process.env.S3_BUCKET;
  const fileUrl = bucket
    ? `https://${bucket}.s3.amazonaws.com/${fileKey}`
    : fileKey;

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
        source: "api",
      },
    });
  }

  return {
    invoiceId: invoice.id,
    autoApproved: shouldAutoApprove,
    confidence: Number(extraction.confidence) || 0,
  };
}
