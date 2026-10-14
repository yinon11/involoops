import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { downloadFile } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Whitelist of file basenames we accept. Logos are written by
 * `/api/upload/logo` as `<userId>/logos/<uuid>.<ext>` where `<uuid>` is
 * a v4 UUID and `<ext>` is one of png/jpg/jpeg/webp/svg. Anything else
 * is either a path-traversal attempt or a stale link.
 */
const NAME_RE = /^[a-zA-Z0-9-]{1,128}\.(png|jpe?g|webp|svg)$/i;

function contentTypeForExt(name: string): string {
  const ext = name.toLowerCase().split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

/**
 * GET /api/files/logo/<name>
 *
 * Same-origin proxy for invoice-template logos so the browser never
 * touches the MinIO/S3 host directly. This keeps the bucket private,
 * sidesteps the wildcard-cert / Cloudflare-proxy / SigV4 friction we
 * hit on `sandbox.s3api.involoops.com`, and lets the bytes ride the
 * same TLS / WAF / cache stack as the rest of the app.
 *
 * The route is intentionally **scope-by-construction**: the storage
 * key is built as `<currentUserId>/logos/<name>`, so a session can
 * only ever read its own logos. We never accept a client-supplied
 * userId or full key.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await params;
  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const key = `${session.user.id}/logos/${name}`;
  try {
    const buffer = await downloadFile(key);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentTypeForExt(name),
        "X-Content-Type-Options": "nosniff",
        // Logos are immutable per UUID — a new upload mints a new name.
        // Cache aggressively in the browser; `private` keeps it out of
        // shared caches (Cloudflare, corporate proxies) since the bytes
        // are user-specific.
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
