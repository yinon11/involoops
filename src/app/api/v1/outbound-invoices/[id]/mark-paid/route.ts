import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import {
  callerFromUserId,
  updateOutboundInvoiceStatusOp,
} from "@/lib/outbound/operations";
import { serializeOutboundInvoice } from "@/lib/api/serializers/outbound-invoice";
import { outboundInvoiceMarkPaidSchema } from "@/lib/api/schemas";
import { mapOutboundDomainError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/outbound-invoices/{id}/mark-paid
 *
 * Transitions an issued/sent invoice to `paid`. Idempotent on
 * `Idempotency-Key`. The body is currently passthrough; future fields
 * (paid_at, payments) will be added without bumping the API version.
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
      body: outboundInvoiceMarkPaidSchema,
      idempotency: "required",
    },
    async ({ ctx }) => {
      const caller = await callerFromUserId(ctx.user.id);
      try {
        const row = await updateOutboundInvoiceStatusOp(caller, id, "paid");
        return { status: 200, body: serializeOutboundInvoice(row) };
      } catch (err) {
        throw mapOutboundDomainError(err);
      }
    },
  );
}
