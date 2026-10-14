import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { buildPage, parsePaginationParams } from "@/lib/api/pagination";
import {
  callerFromUserId,
  createOutboundInvoiceOp,
  listOutboundInvoicesOp,
} from "@/lib/outbound/operations";
import {
  serializeOutboundInvoiceListRow,
  serializeOutboundInvoice,
} from "@/lib/api/serializers/outbound-invoice";
import { outboundInvoiceCreateSchema } from "@/lib/api/schemas";
import { mapOutboundDomainError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/outbound-invoices
 *
 * Returns the user's outbound documents (drafts + issued + …) ordered
 * by created_at DESC. Cursor pagination atop the list-row projection.
 *
 * Note: the underlying op already filters out soft-deleted rows.
 * Server-side cursor filtering happens in JS over the result page —
 * acceptable given the modest list sizes today; will move into SQL
 * when we wire richer filters (status, document_type, customer_id).
 */
export async function GET(req: NextRequest) {
  return runApiRoute(req, { scopes: ["outbound:read"] }, async ({ ctx, url }) => {
    const { limit, cursor } = parsePaginationParams(url);
    const caller = await callerFromUserId(ctx.user.id);
    const all = await listOutboundInvoicesOp(caller);

    let rows = all;
    if (cursor) {
      const cursorMs = Number.isFinite(Number(cursor.k)) ? Number(cursor.k) : NaN;
      if (Number.isFinite(cursorMs)) {
        rows = all.filter((r) => {
          const t = r.createdAt ? r.createdAt.getTime() : 0;
          return t < cursorMs || (t === cursorMs && r.id < cursor.id);
        });
      }
    }
    const sliced = rows.slice(0, limit + 1);
    return {
      status: 200,
      body: buildPage(
        sliced.map(serializeOutboundInvoiceListRow),
        limit,
        (r) => (r.created_at ? String(new Date(r.created_at).getTime()) : "0"),
      ),
    };
  });
}

/**
 * POST /api/v1/outbound-invoices — create a draft.
 * Idempotency-Key required; the gapless allocator runs inside the create op.
 */
export async function POST(req: NextRequest) {
  return runApiRoute(
    req,
    {
      scopes: ["outbound:write"],
      body: outboundInvoiceCreateSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      const caller = await callerFromUserId(ctx.user.id);
      try {
        const row = await createOutboundInvoiceOp(caller, {
          documentType: body.document_type,
          templateId: body.template_id ?? null,
          customerId: body.customer_id ?? null,
          invoiceDate: body.invoice_date,
          dueDate: body.due_date ?? null,
          items: body.items,
          subtotal: body.subtotal,
          vatRate: body.vat_rate,
          vatAmount: body.vat_amount,
          total: body.total,
          currency: body.currency,
          language: body.language,
          notes: body.notes ?? null,
          payments: body.payments,
          referencesDocumentId: body.references_document_id ?? null,
        });
        return { status: 201, body: serializeOutboundInvoice(row) };
      } catch (err) {
        throw mapOutboundDomainError(err);
      }
    },
  );
}
