import { NextRequest, NextResponse } from "next/server";
import {
  callerFromUserId,
  getOutboundInvoiceByIdOp,
} from "@/lib/outbound/operations";
import { verifyOutboundPdfToken } from "@/lib/outbound/pdf-download-link";
import { downloadFile } from "@/lib/storage";
import { resolveStorageKeyFromFileUrl } from "@/lib/storage-key";
import { handOutStoredInvoicePdf } from "@/lib/outbound/invoice-pdf-copy";
import { ensureCustomerCopyPdf } from "@/lib/outbound/finalize-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/outbound-invoices/{id}/pdf/file?token=...
 *
 * Streams an issued outbound PDF. The token from
 * `GET /outbound-invoices/{id}/pdf` is the only credential; it expires
 * after 5 minutes. The object is read from private storage inside the
 * server.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const verified = verifyOutboundPdfToken(token, id);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }

  let pdfUrl: string | null = null;
  let ownerUserId: string | null = null;
  let originalReleased = false;
  let filename = "invoice.pdf";
  try {
    const caller = await callerFromUserId(verified.userId);
    const row = await getOutboundInvoiceByIdOp(caller, id);
    pdfUrl = row?.pdfUrl ?? null;
    ownerUserId = row?.userId ?? null;
    originalReleased = row?.originalReleasedAt != null;
    if (row?.formattedNumber) {
      filename = `invoice-${safeFilename(row.formattedNumber)}.pdf`;
    }
  } catch (err) {
    console.error("[outbound-pdf] lookup failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!pdfUrl || !ownerUserId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const key = resolveStorageKeyFromFileUrl(pdfUrl);
  if (!key || !key.startsWith(`${verified.userId}/`)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Preview shows the same file the next handout would, without using
  // up the one מקור. `copy=1` remains the older "always the copy" request.
  const preview = req.nextUrl.searchParams.get("preview") === "1";
  const forceCopy = req.nextUrl.searchParams.get("copy") === "1";

  try {
    let buffer: Buffer | null;
    if (preview && !originalReleased) {
      buffer = await downloadFile(key);
    } else if (preview || forceCopy) {
      buffer = await ensureCustomerCopyPdf(id);
    } else {
      const handed = await handOutStoredInvoicePdf({
        invoiceId: id,
        pdfUrl,
        ownerUserId: verified.userId,
      });
      buffer = handed.ok
        ? handed.buffer
        : handed.reason === "missing_copy"
          ? await ensureCustomerCopyPdf(id)
          : null;
    }
    if (!buffer) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[outbound-pdf] download failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load file" }, { status: 500 });
  }
}

function safeFilename(value: string): string {
  const cleaned = value.replace(/[^\w.\-]+/g, "_").replace(/^\.+|\.+$/g, "");
  return cleaned.slice(0, 80) || "invoice";
}
