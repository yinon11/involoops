import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Defend against SSRF on webhook delivery. The user controls the URL, so
 * without this a malicious registration could make the worker fetch
 * `http://169.254.169.254/latest/meta-data/` (AWS IMDS) or internal
 * hosts on the VPC.
 *
 * Checks:
 *   1. Scheme must be https (http allowed only in NODE_ENV=development).
 *   2. Hostname must resolve; the resolved IP must not be private,
 *      loopback, link-local, or the IMDS range.
 *
 * We re-check at DELIVERY time, not just registration — DNS answers can
 * flip (rebinding). The `lookup` call resolves once; the worker then
 * passes that exact IP back in the fetch (`dispatcher` / `lookup` option)
 * in a future hardening pass. For v1 we accept the tiny TOCTOU window
 * since the worker runs server-side only.
 */

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,       // link-local + IMDS
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT
  /^224\./,            // multicast
  /^255\.255\.255\.255$/,
];

const PRIVATE_V6 = [
  /^::1$/,               // loopback
  /^fc[0-9a-f]{2}:/i,    // ULA
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,             // link-local
  /^::ffff:(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/i,
];

export class WebhookUrlRejectedError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "bad_url"
      | "bad_scheme"
      | "private_ip"
      | "unresolvable",
  ) {
    super(message);
  }
}

function isPrivate(ip: string, family: number): boolean {
  if (family === 4) return PRIVATE_V4.some((r) => r.test(ip));
  if (family === 6) return PRIVATE_V6.some((r) => r.test(ip));
  return true;
}

export function parseWebhookUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookUrlRejectedError("URL could not be parsed", "bad_url");
  }
  const allowHttp = process.env.NODE_ENV === "development";
  if (parsed.protocol === "http:" && !allowHttp) {
    throw new WebhookUrlRejectedError(
      "Webhook URLs must use HTTPS in production",
      "bad_scheme",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebhookUrlRejectedError(
      `Unsupported scheme: ${parsed.protocol}`,
      "bad_scheme",
    );
  }
  return parsed;
}

/**
 * Resolve the URL's hostname and reject if it points to a private /
 * loopback / link-local address. Called both at registration and at
 * delivery time.
 *
 * Skipped when `process.env.WEBHOOK_ALLOW_PRIVATE_IPS === "1"` for local
 * dev with ngrok-less setups. Never set this in production.
 */
export async function assertPublicHttpUrl(url: string): Promise<URL> {
  const parsed = parseWebhookUrl(url);
  if (process.env.WEBHOOK_ALLOW_PRIVATE_IPS === "1") return parsed;

  const host = parsed.hostname;
  // If the host is a literal IP, check directly — skip DNS.
  const literalFamily = isIP(host);
  if (literalFamily !== 0) {
    if (isPrivate(host, literalFamily)) {
      throw new WebhookUrlRejectedError(
        `Hostname ${host} resolves to a private address`,
        "private_ip",
      );
    }
    return parsed;
  }

  let record: { address: string; family: number };
  try {
    record = await lookup(host);
  } catch {
    throw new WebhookUrlRejectedError(
      `Hostname ${host} does not resolve`,
      "unresolvable",
    );
  }
  if (isPrivate(record.address, record.family)) {
    throw new WebhookUrlRejectedError(
      `Hostname ${host} resolves to a private address (${record.address})`,
      "private_ip",
    );
  }
  return parsed;
}
