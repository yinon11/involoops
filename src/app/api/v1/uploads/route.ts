import type { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { uploadJobs } from "@/db/schema";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { uploadCreateSchema } from "@/lib/api/schemas";
import { serializeUploadJob } from "@/lib/api/serializers/upload-job";
import { buildFileKey } from "@/lib/storage";
import { getPublicAppOrigin } from "@/lib/public-app-origin";
import {
  isAllowedMime,
  safeExtensionFromFilename,
} from "@/lib/file-validation";
import { checkUsageLimit } from "@/lib/usage";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/uploads
 *
 * Creates an `upload_job` row and points the caller at `/content`, which
 * streams the bytes through the app. Rate limit + quota mirror the web-app
 * upload route so the API cannot be used to evade existing limits.
 *
 * This used to return a presigned S3 PUT URL instead. That URL was signed
 * against `S3_ENDPOINT`, which has to be a hostname the *caller* can reach;
 * storage has no public hostname, so the PUT failed at DNS and `/process`
 * then answered 409 "File has not finished uploading" — which reads like a
 * timing problem and is not. `/content` already existed for exactly this
 * reason (the mobile app hit it first); it is now the only advertised path.
 *
 * Response carries:
 *   - upload_id   — use this to send the bytes, poll, or process
 *   - url + method + headers  — where and how to send the file
 *   - expires_in_seconds — kept for response-shape compatibility; nothing
 *     expires an `awaiting_upload` job today
 */
export async function POST(req: NextRequest) {
  return runApiRoute(
    req,
    {
      scopes: ["uploads:write"],
      body: uploadCreateSchema,
      idempotency: "required",
    },
    async ({ ctx, body, req: request }) => {
      // Shared 120/min presign limit across web + API — prevents the API
      // from being used to evade the existing per-user cap.
      const limited = await enforceRateLimit(`presign:${ctx.user.id}`, 120, 60);
      if (!limited.ok) {
        throw new ApiError({
          code: "rate_limited",
          status: 429,
          title: "Too many presign requests",
          headers: { "retry-after": String(limited.retryAfter) },
        });
      }

      if (!isAllowedMime(body.content_type)) {
        throw new ApiError({
          code: "unsupported_media_type",
          status: 415,
          title: `Unsupported content_type: ${body.content_type}`,
        });
      }
      const ext = safeExtensionFromFilename(body.file_name);
      if (!ext) {
        throw new ApiError({
          code: "validation_failed",
          status: 422,
          title: "Unsupported file extension",
          detail: "file_name must end in pdf/png/jpg/jpeg/webp/zip",
        });
      }

      const usage = await checkUsageLimit(ctx.user.id);
      if (!usage.allowed) {
        throw new ApiError({
          code: "quota_exceeded",
          status: 429,
          title: "Monthly invoice limit reached",
          detail: `plan=${usage.planName} current=${usage.current} limit=${usage.limit}`,
          headers: { "retry-after": "3600" },
        });
      }

      const uniqueName = `${uuidv4()}.${ext}`;
      // Namespace API uploads so they're easy to tell apart in logs/archival.
      const apiFileName = `api/${uniqueName}`;
      const fileKey = buildFileKey(ctx.user.id, apiFileName);

      const [row] = await db
        .insert(uploadJobs)
        .values({
          userId: ctx.user.id,
          apiKeyId: ctx.credential === "api_key" ? ctx.apiKey.id : null,
          fileKey,
          fileName: body.file_name,
          contentType: body.content_type,
          sizeBytes: body.size_bytes,
          status: "awaiting_upload",
        })
        .returning();

      return {
        status: 201,
        body: {
          ...serializeUploadJob(row),
          upload_id: row.id,
          upload: {
            url: new URL(
              `/api/v1/uploads/${row.id}/content`,
              getPublicAppOrigin(request),
            ).toString(),
            method: "POST",
            // Needs the same Authorization header as this call: a presigned
            // URL carried its own credential, this one does not.
            headers: { "Content-Type": body.content_type },
            expires_in_seconds: 900,
          },
        },
      };
    },
  );
}
