import type { NextRequest } from "next/server";
import { db } from "@/db";
import { outboundInvoices } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError, apiErrors } from "@/lib/api/errors";
import {
  callerFromUserIdForCredit,
  issueCreditNoteOp,
} from "@/lib/outbound/credit-note-op";
import { outboundInvoiceCreditNoteSchema } from "@/lib/api/schemas";
import { serializeOutboundInvoice } from "@/lib/api/serializers/outbound-invoice";
import { outboundDocumentsLockedApiError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/outbound-invoices/{id}/credit-note
 *
 * Issues a credit note (חשבונית זיכוי) against an issued original.
 * Allocates a fresh CREDIT_INVOICE sequence number, signs + archives
 * the credit note under Spec 04/05, and decrements the original's
 * `net_of_credits_amount` under a FOR UPDATE lock. When the remaining
 * balance reaches zero, the original is auto-voided.
 *
 * Compliance invariants are enforced in `issueCreditNoteOp` — the route
 * handler is just a thin translator to/from the API vocabulary.
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
      body: outboundInvoiceCreditNoteSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      const caller = await callerFromUserIdForCredit(ctx.user.id);

      const result = await issueCreditNoteOp(caller, {
        originalInvoiceId: id,
        creditAmount: body.amount,
        reason: body.reason,
        lines: body.lines?.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unit_price,
          vatRate: l.vat_rate,
        })),
      });

      if (!result.success) {
        if (result.documentsLocked) {
          throw outboundDocumentsLockedApiError();
        }
        if (/not found/i.test(result.error)) {
          throw apiErrors.notFound("Invoice");
        }
        if (result.customerDailyLimit) {
          throw new ApiError({
            code: "rate_limited",
            status: 429,
            title: "Daily limit reached for this customer",
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
        // All other validation / state errors come back as 422.
        throw new ApiError({
          code: "validation_failed",
          status: 422,
          title: "Credit note rejected",
          detail: result.error,
        });
      }

      const [row] = await db
        .select()
        .from(outboundInvoices)
        .where(
          and(
            eq(outboundInvoices.id, result.creditNoteId),
            eq(outboundInvoices.businessEntityId, caller.businessEntityId),
            isNull(outboundInvoices.deletedAt),
          ),
        )
        .limit(1);

      return {
        status: 201,
        body: {
          ...(row
            ? serializeOutboundInvoice(row)
            : { id: result.creditNoteId, formatted_number: result.formattedNumber }),
          signed_at: result.signedAt.toISOString(),
          references_document_id: id,
        },
      };
    },
  );
}
