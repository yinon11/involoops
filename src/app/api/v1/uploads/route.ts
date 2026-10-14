import type { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { uploadJobs } from "@/db/schema";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { uploadCreateSchema } from "@/lib/api/schemas";
import { serializeUploadJob } from "@/lib/api/serializers/upload-job";
import { buildFileKey, getPresignedUploadUrl } from "@/lib/storage";
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
 * Mints a presigned S3 PUT URL plus an `upload_job` row to track the
 * lifecycle. Rate limit + quota mirror the web-app presign route so the
 * API cannot be used to evade existing limits.
 *
 * Response carries:
 *   - upload_id   — use this to poll or process
 *   - url + method + headers  — the presigned PUT
 *   - expires_in_seconds — TTL for the PUT URL
 */
export async function POST(req: NextRequest) {
  return runApiRoute(
    req,
    {
      scopes: ["uploads:write"],
      body: uploadCreateSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
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

      const url = await getPresignedUploadUrl(fileKey, body.content_type);

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
            url,
            method: "PUT",
            headers: { "Content-Type": body.content_type },
            expires_in_seconds: 900, // matches UPLOAD_URL_TTL_SECONDS (15 min)
          },
        },
      };
    },
  );
}
