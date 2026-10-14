import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a customer-facing PDF link stays valid. */
export const OUTBOUND_PDF_LINK_TTL_SECONDS = 5 * 60;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Short-lived download link for an issued outbound PDF.
 *
 * The URL is on the app origin (`AUTH_URL`), not the storage host. MinIO
 * stays on localhost; the matching route streams the bytes after checking
 * this token. The token is the credential, so the follow-up GET does not
 * need the API key.
 */
export function mintOutboundPdfDownloadUrl(input: {
  userId: string;
  invoiceId: string;
  nowMs?: number;
}): { url: string; expiresInSeconds: number } {
  if (!UUID.test(input.userId) || !UUID.test(input.invoiceId)) {
    throw new Error("Invalid invoice download subject");
  }
  const exp =
    Math.floor((input.nowMs ?? Date.now()) / 1000) +
    OUTBOUND_PDF_LINK_TTL_SECONDS;
  const body = `${input.userId}.${input.invoiceId}.${exp}`;
  const sig = sign(body);
  if (!sig) throw new Error("AUTH_SECRET is not set");
  const token = `${body}.${sig}`;
  const url = new URL(
    `/api/v1/outbound-invoices/${input.invoiceId}/pdf/file`,
    `${publicAppOrigin()}/`,
  );
  url.searchParams.set("token", token);
  return { url: url.toString(), expiresInSeconds: OUTBOUND_PDF_LINK_TTL_SECONDS };
}

export function verifyOutboundPdfToken(
  token: string,
  invoiceId: string,
  nowMs: number = Date.now(),
): { userId: string } | null {
  if (!UUID.test(invoiceId)) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userId, id, expStr, sig] = parts;
  if (!userId || !id || !expStr || !sig) return null;
  if (!UUID.test(userId) || id !== invoiceId) return null;
  if (!/^\d{1,12}$/.test(expStr)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 <= nowMs) return null;
  const body = `${userId}.${id}.${expStr}`;
  const expected = sign(body);
  if (!expected) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { userId };
}

function publicAppOrigin(): string {
  const raw = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (!raw) throw new Error("AUTH_URL is not set");
  return new URL(raw).origin;
}

function sign(body: string): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`outbound-pdf-v1\n${body}`)
    .digest("base64url");
}
