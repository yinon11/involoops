import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_SECONDS = 5 * 60;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Short-lived URL that streams an expense file without a bearer token.
 * The phone's image component cannot attach Authorization headers.
 */
export function mintExpenseFileUrl(input: {
  userId: string;
  invoiceId: string;
  nowMs?: number;
}): { url: string; expiresInSeconds: number } {
  if (!UUID.test(input.userId) || !UUID.test(input.invoiceId)) {
    throw new Error("Invalid expense file subject");
  }
  const exp =
    Math.floor((input.nowMs ?? Date.now()) / 1000) + TTL_SECONDS;
  const body = `${input.userId}.${input.invoiceId}.${exp}`;
  const sig = sign(body);
  if (!sig) throw new Error("AUTH_SECRET is not set");
  const token = `${body}.${sig}`;
  const origin = publicAppOrigin();
  const url = new URL(`/api/v1/invoices/${input.invoiceId}/file`, `${origin}/`);
  url.searchParams.set("token", token);
  return { url: url.toString(), expiresInSeconds: TTL_SECONDS };
}

export function verifyExpenseFileToken(
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
    .update(`expense-file-v1\n${body}`)
    .digest("base64url");
}
