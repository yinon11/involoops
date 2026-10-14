/**
 * Upload-job worker. Drains queued extraction jobs with FOR UPDATE SKIP
 * LOCKED, runs the extraction op, records the resulting invoice_id, and
 * emits an `invoice.processed` webhook. See docs/api/06-uploads-and-extraction.md.
 */

import { db } from "@/db";
import { uploadJobs } from "@/db/schema";
import { inArray, sql } from "drizzle-orm";
import { emitEvent } from "@/lib/webhooks/emit";
import { DuplicateFileError, extractAndInsert } from "./extract";

const MAX_ATTEMPTS = 3;
const LOCK_TTL_MS = 10 * 60 * 1000; // if the worker crashes, rows re-claim after 10 min

export interface UploadJobBatchSummary {
  processed: number;
  done: number;
  failed: number;
  dead: number;
}

export async function runUploadJobBatch(
  batchSize: number = 10,
  jobId?: string,
): Promise<UploadJobBatchSummary> {
  let done = 0;
  let failed = 0;
  let dead = 0;

  const claimed = await db.transaction(async (tx) => {
    // Compare with the database clock. A JavaScript Date in this raw query
    // is handed to the driver as a Date object and the claim crashes before
    // any row is locked (`Received an instance of Date`).
    const rows: {
      id: string;
      userId: string;
      fileKey: string;
      fileName: string;
      attempts: number;
    }[] = (await tx.execute(
      sql`
        SELECT id, user_id AS "userId", file_key AS "fileKey",
               file_name AS "fileName", attempts
        FROM upload_jobs
        WHERE status = 'queued'
          AND (locked_until IS NULL OR locked_until <= NOW())
          ${jobId ? sql`AND id = ${jobId}` : sql``}
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `,
    )) as never;

    if (!Array.isArray(rows) || rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const lockUntil = new Date(Date.now() + LOCK_TTL_MS);
    await tx
      .update(uploadJobs)
      .set({ status: "processing", lockedUntil: lockUntil, updatedAt: new Date() })
      .where(inArray(uploadJobs.id, ids));
    return rows;
  });

  for (const row of claimed) {
    const attempts = row.attempts + 1;
    try {
      const result = await extractAndInsert({
        userId: row.userId,
        fileKey: row.fileKey,
        fileName: row.fileName,
      });
      await db
        .update(uploadJobs)
        .set({
          status: "done",
          attempts,
          lockedUntil: null,
          invoiceId: result.invoiceId,
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(sql`${uploadJobs.id} = ${row.id}`);
      done += 1;

      void emitEvent({
        userId: row.userId,
        eventType: "invoice.processed",
        data: {
          upload_id: row.id,
          invoice_id: result.invoiceId,
          status: "done",
          auto_approved: result.autoApproved,
          confidence: result.confidence,
        },
      });
    } catch (err) {
      const isDuplicate = err instanceof DuplicateFileError;
      const message =
        err instanceof Error ? err.message.slice(0, 2000) : String(err).slice(0, 2000);
      const code = isDuplicate
        ? "duplicate_file"
        : err instanceof Error && err.name
          ? err.name
          : "extraction_failed";

      // Duplicates are terminal — no point retrying the same file.
      const terminal = isDuplicate || attempts >= MAX_ATTEMPTS;

      await db
        .update(uploadJobs)
        .set({
          status: terminal ? "error" : "queued",
          attempts,
          lockedUntil: null,
          errorCode: code.slice(0, 100),
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(sql`${uploadJobs.id} = ${row.id}`);

      if (terminal) {
        dead += 1;
        void emitEvent({
          userId: row.userId,
          eventType: "invoice.processing_failed",
          data: {
            upload_id: row.id,
            status: "error",
            error_code: code,
            error_message: message,
            ...(isDuplicate && err instanceof DuplicateFileError
              ? { existing_invoice_id: err.existingInvoiceId }
              : {}),
          },
        });
      } else {
        failed += 1;
      }
    }
  }

  return { processed: claimed.length, done, failed, dead };
}
