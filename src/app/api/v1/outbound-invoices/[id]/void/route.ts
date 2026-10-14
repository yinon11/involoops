import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import {
  callerFromUserId,
  updateOutboundInvoiceStatusOp,
} from "@/lib/outbound/operations";
import { serializeOutboundInvoice } from "@/lib/api/serializers/outbound-invoice";
import { outboundInvoiceVoidSchema } from "@/lib/api/schemas";
import { mapOutboundDomainError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/outbound-invoices/{id}/void
 *
 * Voids an issued receipt, proforma or delivery note. The transition to
 * `voided` writes a VOIDED audit entry; subsequent reads still surface the
 * row (with status set). Tax invoices, tax invoice-receipts and credit
 * invoices are refused with 422 `cannot_void_document_type`: they are cancelled with a credit invoice
 * (`POST /api/v1/outbound-invoices/{id}/credit-note`), never voided.
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
      body: outboundInvoiceVoidSchema,
      idempotency: "required",
    },
    async ({ ctx }) => {
      const caller = await callerFromUserId(ctx.user.id);
      try {
        const row = await updateOutboundInvoiceStatusOp(caller, id, "voided");
        return { status: 200, body: serializeOutboundInvoice(row) };
      } catch (err) {
        throw mapOutboundDomainError(err);
      }
    },
  );
}
