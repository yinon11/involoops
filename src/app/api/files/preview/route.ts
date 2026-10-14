import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { downloadFile } from "@/lib/storage";
import { resolveStorageKeyFromFileUrl } from "@/lib/storage-key";

function guessContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  return "application/octet-stream";
}

/**
 * GET /api/files/preview?invoiceId=...
 *
 * Streams an invoice file from S3/MinIO (same-origin) so iframes work; a
 * redirect would break embedding (X-Frame-Options / CSP on MinIO).
 *
 * Access control: the invoice row is looked up by `(id, userId)` — we never
 * accept a client-supplied S3 key. The previous `?key=` parameter was removed
 * because a prefix-based ownership check on a client-controlled string is
 * brittle (URL encoding, collision on shared prefixes) and offers no benefit.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const invoiceId = req.nextUrl.searchParams.get("invoiceId");

  if (!invoiceId) {
    return NextResponse.json(
      { error: "invoiceId is required" },
      { status: 400 }
    );
  }

  const row = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)),
    columns: { fileUrl: true },
  });
  if (!row?.fileUrl?.trim()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const key = resolveStorageKeyFromFileUrl(row.fileUrl);
  if (!key) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  // Defense in depth: the row is already scoped to this user by the query
  // above, so this only catches a stored key that does not follow the
  // `{userId}/{year}/{month}/{file}` scheme `buildFileKey` produces.
  //
  // If you are here because sandbox shows "stored under an unexpected path"
  // on every historical invoice: that is the documented seeding artifact, not
  // a bug, and the fix is NOT to relax this check — see
  // docs/deployment-sandbox.md, "Invoice file previews show ...". This test
  // cannot tell an account's own previous id from someone else's, so
  // loosening it to quiet sandbox opens a cross-account read on production.
  //
  // That is a data problem, not an attack, and it used to fail completely
  // silently — the user saw "Not authorized to view this file" with nothing
  // in the logs to say why, and the 401 above produced the exact same string.
  // Log enough to tell the two apart without putting the full key (which can
  // carry a filename) into the log.
  if (!key.startsWith(`${userId}/`)) {
    console.error(
      `[preview] key prefix mismatch for invoice ${invoiceId}: ` +
        `expected "${userId}/", key starts "${key.slice(0, 40)}"`,
    );
    return NextResponse.json(
      { error: "Forbidden", reason: "key_prefix_mismatch" },
      { status: 403 },
    );
  }

  try {
    const buffer = await downloadFile(key);
    const body = new Uint8Array(buffer);
    return new NextResponse(body, {
      headers: {
        "Content-Type": guessContentType(key),
        // `inline` but with nosniff to prevent MIME confusion; X-Frame-Options
        // is intentionally NOT set so our own dashboard iframe can embed it.
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (e) {
    console.error("preview download failed:", e);
    return NextResponse.json({ error: "Failed to load file" }, { status: 500 });
  }
}
