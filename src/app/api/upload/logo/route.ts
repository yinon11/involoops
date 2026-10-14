import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { uploadFile } from "@/lib/storage";
import { v4 as uuidv4 } from "uuid";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 415 });
  }

  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 2MB)" }, { status: 413 });
  }

  const ext = contentType.split("/")[1] === "svg+xml" ? "svg" : contentType.split("/")[1];
  const filename = `${uuidv4()}.${ext}`;
  const key = `${session.user.id}/logos/${filename}`;

  await uploadFile(Buffer.from(body), key, contentType);

  // `storedAs` is what the template editor persists into
  // invoice_templates.logo_url — the `s3:` convention is documented in
  // src/lib/templates/logo.ts.
  //
  // `url` is what the editor renders in the live preview. We return a
  // same-origin proxy URL (not a presigned MinIO URL) so the browser
  // never has to talk to the bucket directly. The bucket can stay
  // private, and we sidestep cross-host TLS / CORS issues that come
  // up when the public S3 hostname sits behind Cloudflare or a
  // wildcard cert that doesn't cover its subdomain.
  const url = `/api/files/logo/${encodeURIComponent(filename)}`;
  return NextResponse.json({ url, key, storedAs: `s3:${key}` });
}
