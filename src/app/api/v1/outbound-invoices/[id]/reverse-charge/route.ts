import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError, apiErrors } from "@/lib/api/errors";
import { callerFromUserId, getOutboundInvoiceByIdOp } from "@/lib/outbound/operations";
import {
  removeReverseChargeOp,
  switchOnReverseChargeOp,
} from "@/lib/outbound/reverse-charge";
import {
  latestConsentFor,
  sellerAcknowledgementText,
  type ConsentLocale,
} from "@/lib/outbound/reverse-charge-consent";
import { reverseChargeToggleSchema, type ReverseChargeToggle } from "@/lib/api/schemas";
import { mapOutboundDomainError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InvoiceRow = NonNullable<Awaited<ReturnType<typeof getOutboundInvoiceByIdOp>>>;

/** The reverse-charge state the phone's panel renders. */
async function reverseChargeBody(row: InvoiceRow) {
  const locale: ConsentLocale = row.language === "en" ? "en" : "he";
  // Route B: a replacement issued after a refusal carries the consent that
  // was signed on the original — read it from there, judged against the
  // replacement's facts (same rule the web invoice page applies).
  const latest = row.reverseChargeReplacesId
    ? await latestConsentFor(row.reverseChargeReplacesId, row.id)
    : await latestConsentFor(row.id);
  return {
    object: "outbound_invoice_reverse_charge" as const,
    reverse_charge: row.reverseCharge,
    seller_acknowledgement: sellerAcknowledgementText(locale),
    consent: latest
      ? {
          state: latest.state,
          recipient_email: latest.consent.recipientEmail,
          expires_at: latest.consent.expiresAt.toISOString(),
          signed_at: latest.consent.signedAt?.toISOString() ?? null,
          signer_name: latest.consent.signerName,
        }
      : null,
  };
}

/**
 * GET /api/v1/outbound-invoices/{id}/reverse-charge
 *
 * Reverse-charge state of a document: whether the switch is on, the
 * seller's responsibility acknowledgement text (in the document's
 * language), and the newest buyer-consent request with its state
 * (`pending` / `signed` / `expired` / `revoked` / `stale`). Issuing a
 * reverse-charge draft requires a `signed` consent that still matches
 * the draft's facts.
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
    return { status: 200, body: await reverseChargeBody(row) };
  });
}

/**
 * POST /api/v1/outbound-invoices/{id}/reverse-charge
 *
 * Flip the reverse-charge switch on a draft. `enable` zeroes the VAT
 * (the buyer self-accounts for it; tax invoice / invoice-receipt only,
 * and the customer must carry a valid tax id). `disable` restores the
 * statutory rate. Returns the same body as GET.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    {
      scopes: ["outbound:write"],
      body: reverseChargeToggleSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      const { action } = body as ReverseChargeToggle;
      const caller = await callerFromUserId(ctx.user.id);
      try {
        const result =
          action === "enable"
            ? await switchOnReverseChargeOp(caller, id)
            : await removeReverseChargeOp(caller, id);
        if (!result.success) {
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title: action === "enable" ? "Reverse charge refused" : "Cannot remove reverse charge",
            detail: result.error,
          });
        }
        const row = await getOutboundInvoiceByIdOp(caller, id);
        if (!row) throw apiErrors.notFound("Outbound invoice");
        return { status: 200, body: await reverseChargeBody(row) };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw mapOutboundDomainError(err);
      }
    },
  );
}
