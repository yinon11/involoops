"use server";

import { revalidatePath } from "next/cache";
import { requireDocumentActor } from "@/lib/outbound/document-actor";
import {
  createConsentRequest,
  type ConsentLocale,
  type ConsentSnapshot,
} from "@/lib/outbound/reverse-charge-consent";
import { sendReverseChargeConsentEmail } from "@/lib/email/reverse-charge-consent";
import {
  removeReverseChargeOp,
  switchOnReverseChargeOp,
} from "@/lib/outbound/reverse-charge";

function appOrigin(): string {
  const u =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000";
  return u.replace(/\/$/, "");
}

/**
 * Ask the buyer to sign a reverse-charge consent for this draft.
 *
 * The seller's acknowledgement is an argument, not a default: the caller
 * must pass `true`, which the UI only does once the seller ticked the box
 * under the responsibility text.
 *
 * The link comes back to the seller as well as going out by email. The raw
 * token is never stored, so this response is the only chance to see it —
 * and a seller whose buyer lives on WhatsApp should not have to wait for
 * SES to be fixed.
 */
export async function requestReverseChargeConsent(params: {
  documentId: string;
  sellerAcknowledged: boolean;
  recipientEmail?: string | null;
}): Promise<
  | {
      ok: true;
      link: string;
      recipientEmail: string;
      expiresAt: string;
      emailSent: boolean;
      emailError?: string;
    }
  | { ok: false; error: string }
> {
  const { userId } = await requireDocumentActor(
    params.documentId,
    "reverse-charge-consent-actions",
  );

  const created = await createConsentRequest({
    documentId: params.documentId,
    actorUserId: userId,
    sellerAcknowledged: params.sellerAcknowledged,
    recipientEmail: params.recipientEmail,
  });
  if (!created.ok) return created;

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

  revalidatePath(`/outbound/${params.documentId}`);
  return {
    ok: true,
    link,
    recipientEmail: created.recipientEmail,
    expiresAt: created.expiresAt.toISOString(),
    emailSent: sent.ok,
    ...(sent.ok ? {} : { emailError: sent.error }),
  };
}

/**
 * The reverse-charge switch, turned on: the draft becomes a reverse-charge
 * invoice (VAT → 0). The buyer's signature is the next step; issuing waits
 * for it.
 */
export async function switchOnReverseCharge(
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireDocumentActor(
    documentId,
    "reverse-charge-consent-actions",
  );
  const res = await switchOnReverseChargeOp(caller, documentId);
  revalidatePath(`/outbound/${documentId}`);
  return res.success ? { ok: true } : { ok: false, error: res.error };
}

/** Back to an ordinary invoice at the statutory VAT rate. */
export async function removeReverseCharge(
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireDocumentActor(
    documentId,
    "reverse-charge-consent-actions",
  );
  const res = await removeReverseChargeOp(caller, documentId);
  revalidatePath(`/outbound/${documentId}`);
  return res.success ? { ok: true } : { ok: false, error: res.error };
}
