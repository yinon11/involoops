import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError, apiErrors } from "@/lib/api/errors";
import {
  callerFromUserId,
  getOutboundInvoiceByIdOp,
} from "@/lib/outbound/operations";
import { mintOutboundPdfDownloadUrl } from "@/lib/outbound/pdf-download-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/outbound-invoices/{id}/pdf
 *
 * Returns a short-lived URL on this app that streams the PDF. Storage
 * stays private; the link itself expires after 5 minutes.
 *
 * Returns 404 when the invoice has no `pdf_url` (still a draft).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(req, { scopes: ["outbound:read"] }, async ({ ctx }) => {
    const caller = await callerFromUserId(ctx.user.id);
    const row = await getOutboundInvoiceByIdOp(caller, id);
    if (!row) throw apiErrors.notFound("Outbound invoice");
    if (!row.pdfUrl) {
      // Distinguish "still a draft" from "issued but PDF publish hasn't
      // landed yet" — the second case is rare (the operational upload
      // failed) but spamming "issue the document first" when status is
      // already `issued` sends callers down the wrong path.
      const stillDraft = row.status === "draft";
      throw new ApiError({
        code: "not_found",
        status: 404,
        title: stillDraft
          ? "PDF not yet generated"
          : "PDF not yet available",
        detail: stillDraft
          ? "Issue the document first to render a PDF."
          : "The document is issued; the PDF is still being published. Retry shortly.",
      });
    }
    const link = mintOutboundPdfDownloadUrl({
      userId: ctx.user.id,
      invoiceId: id,
    });
    return {
      status: 200,
      body: {
        url: link.url,
        expires_in_seconds: link.expiresInSeconds,
      },
    };
  });
}
