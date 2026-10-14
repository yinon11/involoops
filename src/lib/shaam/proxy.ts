/**
 * Outbound HTTP proxy for SHAAM (ITA) traffic.
 *
 * The ITA OAuth + clearance endpoints only accept connections from
 * Israeli IPs — and not from every Israeli IP: the OAuth host
 * (openapi.taxes.gov.il) filters by range, so an Israeli cloud address
 * can still be dropped. When InvoLoops is hosted elsewhere we tunnel
 * every shaam request through a proxy whose egress ITA accepts,
 * configured via `SHAAM_PROXY_URL`. The current proxy, the accepted
 * ranges and how to check a new address are in
 * docs/ita-compliance/11-israel-egress.md.
 *
 * Implementation note: we import undici's `fetch` directly rather
 * than calling the global one. Next.js patches `globalThis.fetch`
 * for its caching layer, and that wrapper silently drops undici-
 * specific options like `dispatcher` — so a global `fetch` call
 * with our `ProxyAgent` would bypass the proxy entirely and hang
 * against ITA from the non-IL origin. Node-only by construction;
 * undici isn't available on the Edge runtime.
 */

import type { FetchImpl } from "./client";
import { shaamLog, shaamWarn } from "./debug";

type UndiciModule = typeof import("undici");

let cachedUndici: UndiciModule | null = null;
let cachedAgent: InstanceType<UndiciModule["ProxyAgent"]> | null = null;
let cachedAgentUrl: string | null = null;

function getProxyUrl(): string | null {
  const raw = process.env.SHAAM_PROXY_URL?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** Host:port of the configured proxy, or null. Safe for log lines. */
export function getShaamProxyHostPort(): string | null {
  const url = getProxyUrl();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "80"}`;
  } catch {
    return null;
  }
}

function loadUndici(): UndiciModule {
  if (cachedUndici) return cachedUndici;
  if (
    process.env.NEXT_RUNTIME &&
    process.env.NEXT_RUNTIME !== "nodejs"
  ) {
    throw new Error(
      `SHAAM proxy requires the Node runtime (got NEXT_RUNTIME=${process.env.NEXT_RUNTIME}). ` +
        "Move the caller off the Edge runtime or unset SHAAM_PROXY_URL.",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cachedUndici = require("undici") as UndiciModule;
  return cachedUndici;
}

function getAgent(): InstanceType<UndiciModule["ProxyAgent"]> | null {
  const url = getProxyUrl();
  if (!url) return null;
  if (cachedAgent && cachedAgentUrl === url) return cachedAgent;
  const { ProxyAgent } = loadUndici();
  cachedAgent = new ProxyAgent(url);
  cachedAgentUrl = url;
  return cachedAgent;
}

/**
 * Drop-in replacement for `fetch` that routes traffic through
 * `SHAAM_PROXY_URL` when set, and behaves like global `fetch`
 * otherwise. When the proxy is active we call undici's `fetch`
 * directly to bypass Next.js's patched global fetch.
 */
export const shaamFetch: FetchImpl = (input, init) => {
  const targetUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : String(input);
  const agent = getAgent();
  if (!agent) {
    if (!getProxyUrl()) {
      shaamWarn(
        "proxy",
        "SHAAM_PROXY_URL is not set — calling ITA directly. ITA only accepts Israeli IPs; if this is failing from a non-IL host that's the cause.",
        { url: targetUrl },
      );
    }
    return fetch(input, init);
  }
  shaamLog("proxy", "tunneling request through SHAAM_PROXY_URL", {
    url: targetUrl,
    proxy: getShaamProxyHostPort(),
  });
  const undici = loadUndici();
  // undici's fetch shares the WHATWG signature with global fetch
  // but its types are emitted separately, so the cast is needed.
  return undici.fetch(input as Parameters<UndiciModule["fetch"]>[0], {
    ...(init as Parameters<UndiciModule["fetch"]>[1]),
    dispatcher: agent,
  }) as unknown as ReturnType<typeof fetch>;
};

