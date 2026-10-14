import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { uploadJobs } from "@/db/schema";
import { requireApiKey } from "@/lib/api/authenticate";
import { ApiError, apiErrors, problemResponse } from "@/lib/api/errors";
import { readOrCreateRequestId } from "@/lib/api/request-id";
import { uploadFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same ceiling as the website's server-side upload. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/v1/uploads/{id}/content
 *
 * Writes the file through the app. The phone cannot reach the storage
 * host (`s3api.involoops.com` is internal), so it POSTs the bytes here
 * instead of using the presigned PUT URL from POST /uploads.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = readOrCreateRequestId(req);
  try {
    const { id } = await params;
    const ctx = await requireApiKey(req, ["uploads:write"]);
    const rows = await db
      .select()
      .from(uploadJobs)
      .where(and(eq(uploadJobs.id, id), eq(uploadJobs.userId, ctx.user.id)))
      .limit(1);
    const row = rows[0];
    if (!row) throw apiErrors.notFound("Upload");
    if (row.status !== "awaiting_upload") {
      return new NextResponse(null, { status: 204, headers: { "x-request-id": requestId } });
    }

    const sentType = req.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (sentType && sentType !== row.contentType) {
      throw new ApiError({
        code: "unsupported_media_type",
        status: 415,
        title: "Content-Type does not match the upload",
      });
    }

    const body = await req.arrayBuffer();
    if (body.byteLength === 0) {
      throw new ApiError({
        code: "validation_failed",
        status: 422,
        title: "Empty body",
      });
    }
    if (body.byteLength > MAX_UPLOAD_BYTES || body.byteLength !== row.sizeBytes) {
      throw new ApiError({
        code: "validation_failed",
        status: 422,
        title: "File size does not match the upload",
        detail: `Declared ${row.sizeBytes} bytes, received ${body.byteLength}.`,
      });
    }

    try {
      await uploadFile(Buffer.from(body), row.fileKey, row.contentType);
    } catch (err) {
      console.error("[uploads.content] storage write failed", { requestId, err });
      throw new ApiError({
        code: "internal_error",
        status: 502,
        title: "Failed to store file",
      });
    }

    return NextResponse.json(
      { object: "upload_job", id: row.id, status: row.status },
      { status: 200, headers: { "x-request-id": requestId } },
    );
  } catch (err) {
    if (err instanceof ApiError) return problemResponse(err, requestId);
    console.error("[uploads.content] unhandled", { requestId, err });
    return problemResponse(apiErrors.internal(), requestId);
  }
}
