import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError, apiErrors } from "@/lib/api/errors";
import {
  callerFromUserId,
  cancelAfterShaamRejectionOp,
  getOutboundInvoiceByIdOp,
} from "@/lib/outbound/operations";
import { notifyShaamDecision } from "@/lib/shaam/notify-decision";
import { outboundInvoiceShaamDecisionSchema } from "@/lib/api/schemas";
import type { OutboundInvoiceShaamDecision } from "@/lib/api/schemas";
import { mapOutboundDomainError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/outbound-invoices/{id}/shaam-decision
 *
 * Executes the seller's statutory choice after SHAAM refused to allocate
 * a number (the options arrive in `meta.options` of the 422
 * `shaam_rejected` / `shaam_held` problem returned by POST /issue):
 *
 * - `cancel`  — ביטול החשבונית: voids the document, records the spent
 *   number, and reports the cancellation to the ITA.
 * - `hearing` — reports that the seller chose a hearing
 *   (InvoiceDecisionApi FurtherObjection). The hearing itself happens at
 *   the Tax Authority.
 *
 * `issue_without_allocation` is not here — pass it to POST /issue as
 * `on_rejection` so the same draft is reissued and finalized without an
 * allocation number.
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
      body: outboundInvoiceShaamDecisionSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      const { decision } = body as OutboundInvoiceShaamDecision;
      const caller = await callerFromUserId(ctx.user.id);
      try {
        if (decision === "cancel") {
          const result = await cancelAfterShaamRejectionOp(caller, id);
          if (!result.success) {
            throw new ApiError({
              code: "validation_failed",
              status: 422,
              title: "Cancel refused",
              detail: result.error,
            });
          }
          return {
            status: 200,
            body: {
              object: "outbound_invoice_shaam_decision",
              decision,
              status: "voided",
              formatted_number: result.formattedNumber,
            },
          };
        }

        // Tenant check before the notify helper, which reads by bare id.
        const invoice = await getOutboundInvoiceByIdOp(caller, id);
        if (!invoice) throw apiErrors.notFound("Outbound invoice");
        const result = await notifyShaamDecision({
          documentId: id,
          choice: "request_hearing",
          actorUserId: ctx.user.id,
        });
        return {
          status: 200,
          body: {
            object: "outbound_invoice_shaam_decision",
            decision,
            notified: result.notified,
            reason: result.reason ?? null,
          },
        };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw mapOutboundDomainError(err);
      }
    },
  );
}
