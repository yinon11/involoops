"use server";

import { headers } from "next/headers";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  signConsent,
  type ConsentLocale,
  type ConsentState,
} from "@/lib/outbound/reverse-charge-consent";

async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

/**
 * The buyer's signature, from the public `/consent/[token]` page.
 *
 * Unauthenticated by design — the buyer has no account — so the token is
 * the only credential, and the rate limit is what stands between it and
 * guessing. 32 random bytes are not guessable anyway; the limit is there
 * so a broken client cannot hammer the audit log either.
 *
 * The IP recorded is the first `X-Forwarded-For` hop, which a client can
 * spoof unless the proxy in front overwrites the header. It is evidence
 * alongside the name, the drawn signature and the emailed link, not proof
 * on its own.
 */
export async function signReverseChargeConsentAction(params: {
  token: string;
  signerName: string;
  signerRole?: string | null;
  signaturePng: string;
  locale: ConsentLocale;
}): Promise<
  | { ok: true }
  | { ok: false; error: string; rateLimited?: boolean; state?: ConsentState }
> {
  const ip = await getClientIp();
  const byIp = await enforceRateLimit(`rc-consent:ip:${ip}`, 20, 10 * 60);
  if (!byIp.ok) return { ok: false, error: "rate_limited", rateLimited: true };

  const h = await headers();
  return signConsent({
    rawToken: params.token,
    signerName: params.signerName,
    signerRole: params.signerRole,
    signaturePng: params.signaturePng,
    locale: params.locale === "en" ? "en" : "he",
    ip,
    userAgent: h.get("user-agent"),
  });
}
