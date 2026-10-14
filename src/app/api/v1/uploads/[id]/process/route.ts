import type { NextRequest } from "next/server";
import { db } from "@/db";
import { uploadJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError, apiErrors } from "@/lib/api/errors";
import { serializeUploadJob } from "@/lib/api/serializers/upload-job";
import { uploadProcessSchema } from "@/lib/api/schemas";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { getS3ServerClient } from "@/lib/s3-clients";
import { runUploadJobBatch } from "@/lib/uploads/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/uploads/{id}/process
 *
 * Client calls this after it has PUT the bytes to the presigned URL.
 * We verify the object exists in S3 (HEAD), flip the job's status to
 * `queued`, and return 202. The cron worker drains queued rows and
 * emits `invoice.processed` / `invoice.processing_failed` webhooks.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    {
      scopes: ["uploads:write"],
      body: uploadProcessSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      const rows = await db
        .select()
        .from(uploadJobs)
        .where(
          and(eq(uploadJobs.id, id), eq(uploadJobs.userId, ctx.user.id)),
        )
        .limit(1);
      const row = rows[0];
      if (!row) throw apiErrors.notFound("Upload");

      // Idempotent: if already queued or further along, return the current
      // state verbatim (matches the Idempotency-Key replay intent).
      if (row.status !== "awaiting_upload") {
        return { status: 202, body: serializeUploadJob(row) };
      }

      // Verify the S3 object is actually there. Clients sometimes call
      // /process before the PUT completed; without this check we'd queue
      // a job that crashes in the worker on download.
      const bucket = process.env.S3_BUCKET;
      if (bucket) {
        try {
          await getS3ServerClient().send(
            new HeadObjectCommand({ Bucket: bucket, Key: row.fileKey }),
          );
        } catch {
          throw new ApiError({
            code: "conflict",
            status: 409,
            title: "File has not finished uploading",
            detail:
              "The S3 object is not visible yet. Retry after the PUT completes, or wait a few seconds.",
          });
        }
      }

      const [updated] = await db
        .update(uploadJobs)
        .set({
          status: "queued",
          hint: body as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(uploadJobs.id, id))
        .returning();

      // Cron also drains this queue once a minute. Start this job now so the
      // phone is not left on "Reading the invoice…" waiting for the next tick.
      void runUploadJobBatch(1, id).catch((err) => {
        console.error("[uploads.process] worker kick failed", err);
      });

      return { status: 202, body: serializeUploadJob(updated) };
    },
  );
}
