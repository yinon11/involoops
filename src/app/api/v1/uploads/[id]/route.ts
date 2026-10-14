import type { NextRequest } from "next/server";
import { db } from "@/db";
import { uploadJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { apiErrors } from "@/lib/api/errors";
import { serializeUploadJob } from "@/lib/api/serializers/upload-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/uploads/{id}
 *
 * Polls the upload job's status. For long-running clients, prefer the
 * `invoice.processed` / `invoice.processing_failed` webhook events over
 * polling — both carry the same `upload_id` as this endpoint's id.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(req, { scopes: ["uploads:write"] }, async ({ ctx }) => {
    const rows = await db
      .select()
      .from(uploadJobs)
      .where(and(eq(uploadJobs.id, id), eq(uploadJobs.userId, ctx.user.id)))
      .limit(1);
    const row = rows[0];
    if (!row) throw apiErrors.notFound("Upload");
    return { status: 200, body: serializeUploadJob(row) };
  });
}
