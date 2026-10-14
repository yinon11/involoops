import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError, apiErrors } from "@/lib/api/errors";
import { callerFromUserId, getOutboundInvoiceByIdOp } from "@/lib/outbound/operations";
import {
  createConsentRequest,
  type ConsentLocale,
  type ConsentSnapshot,
} from "@/lib/outbound/reverse-charge-consent";
import { sendReverseChargeConsentEmail } from "@/lib/email/reverse-charge-consent";
import {
  reverseChargeConsentRequestSchema,
  type ReverseChargeConsentRequest,
} from "@/lib/api/schemas";
import { mapOutboundDomainError } from "@/lib/api/outbound-error-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appOrigin(): string {
  const u =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000";
  return u.replace(/\/$/, "");
}

/**
 * POST /api/v1/outbound-invoices/{id}/reverse-charge/consent
 *
 * Ask the buyer to sign the reverse-charge consent for this draft. The
 * signature link is emailed to the buyer and also returned in the
 * response — the raw token is never stored, so this response is the only
 * chance to capture it (e.g. to share over WhatsApp when email fails).
 * `seller_acknowledged` must be true: it attests the seller accepted the
 * acknowledgement text from GET .../reverse-charge.
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
      body: reverseChargeConsentRequestSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      const input = body as ReverseChargeConsentRequest;
      if (input.seller_acknowledged !== true) {
        throw new ApiError({
          code: "validation_failed",
          status: 422,
          title: "Seller acknowledgement required",
          detail: "Pass seller_acknowledged: true after presenting the acknowledgement text.",
        });
      }
      const caller = await callerFromUserId(ctx.user.id);
      const row = await getOutboundInvoiceByIdOp(caller, id);
      if (!row) throw apiErrors.notFound("Outbound invoice");
      try {
        const created = await createConsentRequest({
          documentId: id,
          actorUserId: ctx.user.id,
          sellerAcknowledged: true,
          recipientEmail: input.recipient_email,
        });
        if (!created.ok) {
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title: "Consent request refused",
            detail: created.error,
          });
        }
        const locale: ConsentLocale = created.language === "en" ? "en" : "he";
        const link = `${appOrigin()}/consent/${encodeURIComponent(created.rawToken)}?lang=${locale}`;
        const snapshot: ConsentSnapshot = created.snapshot;
        const sent = await sendReverseChargeConsentEmail({
          to: created.recipientEmail,
          token: created.rawToken,
          sellerName: snapshot.seller.name,
          amount: `${snapshot.subtotal} ${snapshot.currency}`,
          expiresAt: created.expiresAt,
          locale,
        });
        return {
          status: 200,
          body: {
            object: "outbound_invoice_reverse_charge_consent",
            link,
            recipient_email: created.recipientEmail,
            expires_at: created.expiresAt.toISOString(),
            email_sent: sent.ok,
            email_error: sent.ok ? null : sent.error,
          },
        };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw mapOutboundDomainError(err);
      }
    },
  );
}
