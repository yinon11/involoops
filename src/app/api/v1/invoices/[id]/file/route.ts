import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { downloadFile } from "@/lib/storage";
import { resolveStorageKeyFromFileUrl } from "@/lib/storage-key";
import { verifyExpenseFileToken } from "@/lib/invoices/file-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guessContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

/**
 * GET /api/v1/invoices/{id}/file?token=...
 *
 * Streams the stored expense file. The token from GET /invoices/{id} is
 * the only credential and expires after 5 minutes.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const verified = verifyExpenseFileToken(token, id);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }

  const row = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), eq(invoices.userId, verified.userId)),
    columns: { fileUrl: true },
  });
  if (!row?.fileUrl?.trim()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const key = resolveStorageKeyFromFileUrl(row.fileUrl);
  if (!key || !key.startsWith(`${verified.userId}/`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const buffer = await downloadFile(key);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": guessContentType(key),
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (err) {
    console.error("[expense-file] download failed", err);
    return NextResponse.json({ error: "Failed to load file" }, { status: 500 });
  }
}
