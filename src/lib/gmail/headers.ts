/**
 * Helpers for digging values out of a Gmail API message's `payload.headers`
 * array. The shape from `messages.get({format: "full"})` is
 * `[{name, value}, ...]` with case-insensitive names.
 */

import type { gmail_v1 } from "@googleapis/gmail";

/** Case-insensitive header lookup. Returns the first match or null. */
export function getHeader(
  message: gmail_v1.Schema$Message,
  name: string,
): string | null {
  const headers = message.payload?.headers ?? [];
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.name?.toLowerCase() === lower && typeof h.value === "string") {
      return h.value;
    }
  }
  return null;
}

/**
 * Extract the bare email address from a header value. Accepts forms like:
 *   "alice@example.com"
 *   "Alice <alice@example.com>"
 *   "\"Alice, Bob\" <alice@example.com>"
 * Returns lowercase, or null if no email is found.
 */
export function parseEmailAddress(headerValue: string | null): string | null {
  if (!headerValue) return null;
  // Prefer the angle-bracketed form when present — it's the canonical
  // RFC 5322 mailbox token.
  const angled = /<([^>]+)>/.exec(headerValue);
  const candidate = angled ? angled[1] : headerValue.trim();
  // Coarse email validation; if it fails, treat as no address rather than
  // pass garbage downstream.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return null;
  return candidate.toLowerCase();
}

/** DKIM verification result as reported in the Authentication-Results header. */
export type DkimResult =
  | "pass"
  | "fail"
  | "neutral"
  | "policy"
  | "permerror"
  | "temperror"
  | "none";

/**
 * Parse the `dkim=...` field out of the receiver's Authentication-Results
 * header. Gmail adds this header on every inbound message it accepts; it's
 * tamper-evident in the sense that a sender can't forge it past the Gmail
 * MX. Returns "none" if the header is missing or unparseable so callers
 * can treat absence as failure (we never accept invoices without dkim=pass).
 */
export function parseDkimResult(authResults: string | null): DkimResult {
  if (!authResults) return "none";
  const m = /\bdkim\s*=\s*([a-z]+)/i.exec(authResults);
  if (!m) return "none";
  const v = m[1].toLowerCase();
  switch (v) {
    case "pass":
    case "fail":
    case "neutral":
    case "policy":
    case "permerror":
    case "temperror":
    case "none":
      return v;
    default:
      return "none";
  }
}

/**
 * Local-part of an email address (everything before `@`). Returns null
 * if the address is missing or malformed.
 */
export function localPartOf(emailAddress: string | null): string | null {
  if (!emailAddress) return null;
  const at = emailAddress.indexOf("@");
  if (at <= 0) return null;
  return emailAddress.slice(0, at);
}
