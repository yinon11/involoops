import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import {
  callerFromUserId,
  queueOutboundInvoiceForDeliveryOp,
  sendOutboundInvoiceByEmailOp,
} from "@/lib/outbound/operations";
import { outboundInvoiceSendSchema } from "@/lib/api/schemas";
import { mapOutboundDomainError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/outbound-invoices/{id}/send
 *
 * Emails the invoice PDF to the recipient via SES with the PDF attached
 * (SES Raw MIME — Xero/FreshBooks/QuickBooks-style). The invoice's
 * `sent_at` is stamped regardless of prior status; an `issued` invoice
 * transitions to `sent` (firing `outbound_invoice.sent` over webhooks).
 * Re-sends from `sent`/`paid` refresh `sent_at` but leave status alone.
 *
 * Drafts and voided invoices are rejected — only signed documents can
 * be delivered.
 *
 * SHAAM gate (Spec 08+): when `shaam_status` is PENDING / OUTAGE_ISSUED
 * / REJECTED / HELD, the send is refused with HTTP 409 unless the
 * caller passes `force: true` (override) or `queue_for_clear: true`
 * (capture intent and auto-send once the retry cron clears SHAAM).
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
      body: outboundInvoiceSendSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      if (body.force && body.queue_for_clear) {
        throw new ApiError({
          code: "validation_failed",
          status: 422,
          title: "force and queue_for_clear are mutually exclusive",
        });
      }
      const caller = await callerFromUserId(ctx.user.id);
      try {
        // Queue path: capture the send for the cron to fire on clear.
        if (body.queue_for_clear) {
          const queue = await queueOutboundInvoiceForDeliveryOp(caller, {
            invoiceId: id,
            to: body.to,
            subject: body.subject,
            body: body.body,
          });
          if (!queue.success) {
            throw new ApiError({
              code: "validation_failed",
              status: 422,
              title: "Queue rejected",
              detail: queue.error,
            });
          }
          return {
            status: 202,
            body: {
              object: "outbound_invoice_queued_delivery",
              status: "queued_for_shaam_clear",
              queued_at: queue.queuedAt,
              recipient: body.to,
            },
          };
        }

        const result = await sendOutboundInvoiceByEmailOp(caller, {
          invoiceId: id,
          to: body.to,
          subject: body.subject,
          body: body.body,
          force: body.force ?? false,
          source: "manual",
        });
        if (!result.success) {
          if ("shaamGate" in result) {
            throw new ApiError({
              code: "conflict",
              status: 409,
              title: "SHAAM gate refused the send",
              detail: result.error,
            });
          }
          // Domain-level failure (bad recipient, draft/voided, PDF render,
          // SES rejection). Surface as 422 with the upstream message; the
          // caller needs actionable detail.
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title: "Send rejected",
            detail: result.error,
          });
        }
        return {
          status: 200,
          body: {
            object: "outbound_invoice_send_result",
            message_id: result.messageId,
            status: result.newStatus,
            sent_at: result.sentAt,
            recipient: body.to,
            forced: body.force ?? false,
          },
        };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw mapOutboundDomainError(err);
      }
    },
  );
}
