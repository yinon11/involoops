import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError, apiErrors, shaamRefusalApiError } from "@/lib/api/errors";
import {
  callerFromUserId,
  getOutboundInvoiceByIdOp,
  issueOutboundInvoiceOp,
} from "@/lib/outbound/operations";
import { serializeOutboundInvoice } from "@/lib/api/serializers/outbound-invoice";
import { outboundInvoiceIssueSchema } from "@/lib/api/schemas";
import { outboundDocumentsLockedApiError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/outbound-invoices/{id}/issue
 *
 * Allocates the gapless fiscal number (drafts carry NULL numbers until
 * issuance — see `outbound_invoices_issued_has_number` constraint),
 * signs the document, archives the canonical JSON + PDF, and submits
 * to SHAAM. Idempotency-Key required because the underlying op has
 * nontrivial side effects (allocation is reused on retry, never re-burned).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    {
      scopes: ["outbound:issue"],
      body: outboundInvoiceIssueSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      const caller = await callerFromUserId(ctx.user.id);
      const parsed = body as
        | { confirm_zero_vat?: boolean; on_rejection?: "issue_without_allocation" }
        | undefined;
      const result = await issueOutboundInvoiceOp(caller, id, {
        confirmZeroVat: parsed?.confirm_zero_vat === true,
        onRejection: parsed?.on_rejection,
      });
      if (!result.success) {
        if (result.documentsLocked) {
          throw outboundDocumentsLockedApiError();
        }
        if (result.zeroVatConfirmationRequired) {
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title:
              "Zero-VAT tax invoice needs explicit confirmation (confirm_zero_vat)",
            detail: result.error,
          });
        }
        if (result.shaamRejection) {
          throw shaamRefusalApiError(result);
        }
        if (/not found/i.test(result.error)) {
          throw apiErrors.notFound("Outbound invoice");
        }
        if (result.customerDailyLimit) {
          throw new ApiError({
            code: "rate_limited",
            status: 429,
            title: "Daily limit reached for this customer",
            detail: result.error,
          });
        }
        if (/Only draft invoices can be issued/i.test(result.error)) {
          throw new ApiError({
            code: "conflict",
            status: 409,
            title: "Only draft invoices can be issued",
            detail: result.error,
          });
        }
        if (result.reverseChargeBlocked) {
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title: "Reverse charge cannot be issued as it stands",
            detail: result.error,
          });
        }
        if (result.customerTaxIdRequired) {
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title: "Customer tax ID required for an allocation number",
            detail: result.error,
          });
        }
        if (result.dateOrder) {
          throw new ApiError({
            code: "conflict",
            status: 409,
            title: "Document date is earlier than the previous document",
            detail: result.error,
          });
        }
        throw new ApiError({
          code: "internal_error",
          status: 500,
          title: "Failed to issue invoice",
          detail: result.error,
        });
      }

      // Re-read the row so the response carries the post-issue state
      // (status=issued, signed timestamps via audit log, allocation_number
      // if SHAAM cleared inline).
      // Route B: a refused reverse-charge invoice is replaced by a new
      // one, and the new one is what was issued.
      const issuedId = result.replacementInvoiceId ?? id;
      const after = await getOutboundInvoiceByIdOp(caller, issuedId);
      return {
        status: 200,
        body: {
          ...(after ? serializeOutboundInvoice(after) : { id: issuedId }),
          ...(result.replacementInvoiceId ? { replaces_invoice_id: id } : {}),
          signed_at: result.signedAt.toISOString(),
          signing_key_id: result.keyId,
          archive_chain_sequence: result.archiveChainSequence,
          shaam_status: result.shaamStatus,
          allocation_number: result.allocationNumber,
        },
      };
    },
  );
}
