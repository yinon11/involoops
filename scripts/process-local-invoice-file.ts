/**
 * Admin recovery: ingest a local PDF/image from disk through the same
 * upload + extraction pipeline as email intake (no DKIM / Gmail).
 *
 * Usage (inside app container):
 *   npx tsx scripts/process-local-invoice-file.ts <userEmail> <filePath> [originalFileName]
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  loadExtractionContext,
  insertInvoiceFromUploadedBuffer,
} from "@/lib/invoice-upload-processor";
import { uploadFile, buildFileKey } from "@/lib/storage";
import {
  detectMimeFromBytes,
  safeExtensionFromFilename,
} from "@/lib/file-validation";
import { checkUsageLimit, tryReserveInvoiceSlot } from "@/lib/usage";

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
    default:
      return "application/octet-stream";
  }
}

async function resolveUserId(email: string): Promise<string> {
  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  const id = row[0]?.id;
  if (!id) throw new Error(`No user for email ${email}`);
  return id;
}

async function main(): Promise<void> {
  const userEmail = process.argv[2];
  const filePath = process.argv[3];
  const fileName = process.argv[4] ?? basename(filePath);

  if (!userEmail || !filePath) {
    console.error(
      "Usage: npx tsx scripts/process-local-invoice-file.ts <userEmail> <filePath> [originalFileName]",
    );
    process.exit(1);
  }

  const userId = await resolveUserId(userEmail);
  const buffer = readFileSync(filePath);
  const MAX_BYTES = 25 * 1024 * 1024;
  if (buffer.length > MAX_BYTES) {
    throw new Error(`File exceeds ${MAX_BYTES} bytes`);
  }

  const ext = safeExtensionFromFilename(fileName);
  if (!ext) throw new Error(`Unsupported extension: ${fileName}`);
  if (!detectMimeFromBytes(buffer)) {
    throw new Error("Bytes do not match an accepted invoice type");
  }

  const usage = await checkUsageLimit(userId);
  if (!usage.allowed) {
    throw new Error(`Plan limit reached (${usage.current}/${usage.limit})`);
  }

  const reserved = await tryReserveInvoiceSlot(userId, usage.limit);
  if (!reserved) throw new Error("Could not reserve invoice slot");

  const ctx = await loadExtractionContext(userId);
  const key = buildFileKey(userId, `${uuidv4()}.${ext}`);
  await uploadFile(buffer, key, mimeForExt(ext));

  const result = await insertInvoiceFromUploadedBuffer({
    userId,
    fileBuffer: buffer,
    fileKey: key,
    fileName,
    vendorInfos: ctx.vendorInfos,
    vendorRules: ctx.vendorRules,
    anthropicApiKey: ctx.anthropicApiKey,
  });

  if (!result.ok) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "duplicate",
        existingInvoiceId: result.existingInvoiceId,
        fileName,
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      ok: true,
      invoiceId: result.invoice.id,
      fileName,
      status: result.invoice.status,
      invoiceNumber: result.invoice.invoiceNumber,
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
