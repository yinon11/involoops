import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildFileKey, uploadFile } from "@/lib/storage";
import { v4 as uuidv4 } from "uuid";
import {
  isAllowedMime,
  safeExtensionFromFilename,
} from "@/lib/file-validation";
import { enforceRateLimit } from "@/lib/rate-limit";
import { checkUsageLimit } from "@/lib/usage";

export const runtime = "nodejs";

/**
 * Hard cap on a single upload, mirroring the limit enforced again at
 * /api/upload/process when we hash + extract. Cloudflare Free is 100 MB
 * per request, Next.js Route Handlers have no server-side cap on raw
 * `req.body`, so 25 MB is comfortably below both.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/upload/file
 *
 * Server-mediated upload: the browser POSTs the file bytes to the
 * Next.js app, which then writes them to MinIO/S3 over the internal
 * Compose network. Returns the storage `key` so the existing
 * `/api/upload/process` endpoint can pick up extraction unchanged.
 *
 * Replaces the old presign-then-PUT-from-browser flow. That pattern
 * works fine for back-end SDK callers (the public REST API still uses
 * it under `/api/v1/uploads`), but in the browser it requires CORS on
 * the S3 host and forces the user's traffic through whatever Cloudflare
 * / TLS / wildcard-cert setup the bucket is reachable on. Going
 * through the app keeps everything on the single `involoops.com`
 * origin — no second hostname to certify, no SigV4 query for
 * Cloudflare to mangle, and the bucket can stay fully private.
 *
 * Wire format (raw body, not multipart, to avoid an extra parse step):
 *   - `Content-Type:` the file's MIME (must pass `isAllowedMime`)
 *   - `X-File-Name:` the original filename (used for extension check
 *      + later display in the invoice list)
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 120 / 60 s per user. Same `presign:` keyspace as `/api/v1/uploads`
  // so a malicious account can't double its budget by alternating
  // between the in-app and SDK upload endpoints.
  const limited = await enforceRateLimit(`presign:${session.user.id}`, 120, 60);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const contentType = req.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!isAllowedMime(contentType)) {
    return NextResponse.json(
      { error: "Unsupported content type" },
      { status: 415 },
    );
  }

  const fileName = req.headers.get("x-file-name") ?? "";
  if (!fileName || fileName.length > 512) {
    return NextResponse.json(
      { error: "X-File-Name header is required (≤512 chars)" },
      { status: 400 },
    );
  }

  const ext = safeExtensionFromFilename(fileName);
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported file extension" },
      { status: 400 },
    );
  }

  // Up-front quota check, done before we touch S3 so a capped account
  // never spends a write on bytes we'd immediately delete.
  const usage = await checkUsageLimit(session.user.id);
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "Monthly invoice limit reached",
        current: usage.current,
        limit: usage.limit,
        planName: usage.planName,
      },
      { status: 403 },
    );
  }

  const body = await req.arrayBuffer();
  if (body.byteLength === 0) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File exceeds maximum allowed size" },
      { status: 413 },
    );
  }

  const uniqueName = `${uuidv4()}.${ext}`;
  const key = buildFileKey(session.user.id, uniqueName);

  try {
    await uploadFile(Buffer.from(body), key, contentType);
  } catch (err) {
    console.error("[upload.file] storage write failed", err);
    return NextResponse.json(
      { error: "Failed to store file" },
      { status: 502 },
    );
  }

  return NextResponse.json({ key });
}
