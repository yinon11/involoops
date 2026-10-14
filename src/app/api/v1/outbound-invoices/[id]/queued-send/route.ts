import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import {
  callerFromUserId,
  cancelQueuedOutboundInvoiceDeliveryOp,
} from "@/lib/outbound/operations";
import { mapOutboundDomainError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/v1/outbound-invoices/{id}/queued-send
 *
 * Cancel a previously queued auto-send. Idempotent — returns
 * `cleared: false` when no queue was set.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    { scopes: ["outbound:issue"] },
    async ({ ctx }) => {
      const caller = await callerFromUserId(ctx.user.id);
      try {
        const result = await cancelQueuedOutboundInvoiceDeliveryOp(caller, id);
        if (!result.success) {
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title: "Cancel queued delivery rejected",
            detail: result.error,
          });
        }
        return {
          status: 200,
          body: {
            object: "outbound_invoice_queued_delivery_cancellation",
            cleared: result.cleared,
          },
        };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw mapOutboundDomainError(err);
      }
    },
  );
}
