import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { apiErrors } from "@/lib/api/errors";
import {
  callerFromUserId,
  deleteOutboundInvoiceOp,
  getOutboundInvoiceByIdOp,
  updateOutboundInvoiceDraftOp,
} from "@/lib/outbound/operations";
import { serializeOutboundInvoice } from "@/lib/api/serializers/outbound-invoice";
import { outboundInvoiceDraftPatchSchema } from "@/lib/api/schemas";
import { mapOutboundDomainError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(req, { scopes: ["outbound:read"] }, async ({ ctx }) => {
    const caller = await callerFromUserId(ctx.user.id);
    const row = await getOutboundInvoiceByIdOp(caller, id);
    if (!row) throw apiErrors.notFound("Outbound invoice");
    return { status: 200, body: serializeOutboundInvoice(row) };
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    {
      scopes: ["outbound:write"],
      body: outboundInvoiceDraftPatchSchema,
      idempotency: "supported",
    },
    async ({ ctx, body }) => {
      const caller = await callerFromUserId(ctx.user.id);
      try {
        const row = await updateOutboundInvoiceDraftOp(caller, id, {
          customerId: body.customer_id,
          invoiceDate: body.invoice_date,
          dueDate: body.due_date,
          items: body.items,
          subtotal: body.subtotal,
          vatRate: body.vat_rate,
          vatAmount: body.vat_amount,
          total: body.total,
          currency: body.currency,
          language: body.language,
          notes: body.notes,
        });
        return { status: 200, body: serializeOutboundInvoice(row) };
      } catch (err) {
        throw mapOutboundDomainError(err);
      }
    },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    { scopes: ["outbound:write"], idempotency: "supported" },
    async ({ ctx }) => {
      const caller = await callerFromUserId(ctx.user.id);
      try {
        await deleteOutboundInvoiceOp(caller, id);
        return { status: 204, body: null };
      } catch (err) {
        throw mapOutboundDomainError(err);
      }
    },
  );
}
