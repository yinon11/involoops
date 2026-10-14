/**
 * Standalone preflight for SHAAM_PROXY_URL + SHAAM_BASE_URL_*.
 *
 * The OAuth `code` is single-use and short-lived, so re-running the
 * full authorize → callback flow to debug a proxy issue burns one code
 * per attempt and forces you back through the SMS prompt every time.
 * This script lets you probe the same network path without consuming
 * a code:
 *
 *   1. Direct hit to a known sanity URL (https://api.ipify.org) to
 *      confirm the host's outbound network works at all.
 *   2. Proxy hit to a NON-ITA host (https://lumtest.com/myip.json).
 *      What counts as success depends on the proxy:
 *        - domain-allowlisted proxy (our squid in il-central-1): a
 *          REFUSED CONNECT is correct — it proves the allowlist works.
 *        - open proxy (Bright Data et al.): a 200 reporting country.
 *      Either way this says nothing about ITA; probes 3-6 do that.
 *   3. Proxy hit to the OAuth host root (`openapi.taxes.gov.il`) —
 *      any HTTP response proves CONNECT was allowed.
 *   4. Proxy hit to the configured SHAAM token endpoint with an
 *      empty body — we expect a 4xx (invalid_grant / missing
 *      client_id), which is what "proxy can reach ITA OAuth" looks
 *      like from the wire.
 *   5. Proxy hit to the v2 clearance host root
 *      (`ita-api.taxes.gov.il`). The two ITA hosts sit on unrelated
 *      infrastructure — `openapi` on an Israeli ISP netblock, `ita-api`
 *      behind Google Cloud — so probes 3 and 5 can disagree. A pass on
 *      3 + fail on 5 is the clearance-only block.
 *   6. Proxy hit to the clearance endpoint itself with a junk bearer
 *      — expect 4xx. A 401 with an IBM DataPower body is a full pass:
 *      the gateway read the request and rejected the credential, not
 *      the origin.
 *
 * If undici only says "fetch failed" on any of 3-6, re-run the same
 * URL with `curl -v -x "$SHAAM_PROXY_URL" https://<host>/…`. curl shows
 * the proxy's own answer to the CONNECT, which undici collapses into
 * "fetch failed". Against our squid, a 403 means the destination is not
 * on its `.taxes.gov.il` allowlist; a hang means squid reached ITA and
 * ITA dropped it, which is usually the egress IP range — see
 * docs/ita-compliance/11-israel-egress.md.
 *
 * Run:
 *   npx tsx scripts/verify-shaam-proxy.ts
 *   # or against the sandbox env file:
 *   npx dotenv-cli -e .env.sandbox -- npx tsx scripts/verify-shaam-proxy.ts
 *
 * Reads the first existing `.env`, `.env.sandbox`, or `.env.local` in CWD
 * if no env file is loaded by the caller. It does not touch the database.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import {
  describeError,
  shaamError,
  shaamLog,
  shaamWarn,
} from "@/lib/shaam/debug";
import {
  getShaamClearanceBaseUrl,
  getShaamConfig,
  getShaamInvoicePath,
} from "@/lib/shaam/client";
import { getShaamProxyHostPort } from "@/lib/shaam/proxy";

function loadEnvFile() {
  for (const candidate of [".env", ".env.sandbox", ".env.local"]) {
    try {
      const raw = readFileSync(resolve(process.cwd(), candidate), "utf8");
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq === -1) continue;
        const key = t.slice(0, eq).trim();
        let val = t.slice(eq + 1).trim();
        // Strip trailing inline comments only when value is unquoted.
        const hash = val.indexOf(" #");
        if (hash !== -1 && !val.startsWith('"') && !val.startsWith("'")) {
          val = val.slice(0, hash).trim();
        }
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
      break;
    } catch {
      /* try next */
    }
  }
}

loadEnvFile();
process.env.SHAAM_DEBUG ||= "1";

interface ProbeResult {
  name: string;
  ok: boolean;
  status?: number;
  elapsed_ms: number;
  body_preview?: string;
  detail?: string;
  cause_chain?: ReturnType<typeof describeError>;
}

function getProxyAgent(): ProxyAgent | null {
  const url = process.env.SHAAM_PROXY_URL?.trim();
  if (!url) return null;
  return new ProxyAgent(url);
}

async function probe(
  name: string,
  url: string,
  options: { useProxy: boolean; init?: Parameters<typeof undiciFetch>[1] },
): Promise<ProbeResult> {
  const started = Date.now();
  const agent = options.useProxy ? getProxyAgent() : null;
  const init: Parameters<typeof undiciFetch>[1] = {
    ...(options.init ?? {}),
    ...(agent ? { dispatcher: agent } : {}),
    signal: AbortSignal.timeout(15_000),
  };
  try {
    const res = await undiciFetch(url, init);
    const text = await res.text().catch(() => "");
    return {
      name,
      ok: true,
      status: res.status,
      elapsed_ms: Date.now() - started,
      body_preview: text.slice(0, 200),
    };
  } catch (err) {
    return {
      name,
      ok: false,
      elapsed_ms: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
      cause_chain: describeError(err),
    };
  }
}

/**
 * Probe 2 targets a non-ITA host on purpose, so `ok` is the wrong test:
 * against a domain-allowlisted proxy a refused CONNECT is the correct
 * result. Reporting it through `summary()` prints FAIL for a proxy that
 * is working exactly as designed, which sends the reader chasing proxy
 * auth that was never broken.
 */
function summaryAllowlist(r: ProbeResult): void {
  if (!r.ok) {
    shaamLog(
      "preflight",
      `PASS ${r.name} — CONNECT refused, so the proxy's domain allowlist is enforced`,
      { elapsed_ms: r.elapsed_ms, detail: r.detail },
    );
  } else {
    shaamWarn(
      "preflight",
      `NOTE ${r.name} — proxy tunnels to arbitrary hosts; it is not domain-restricted`,
      { status: r.status, elapsed_ms: r.elapsed_ms, body_preview: r.body_preview },
    );
  }
}

function summary(r: ProbeResult): void {
  if (r.ok) {
    shaamLog("preflight", `PASS ${r.name}`, {
      status: r.status,
      elapsed_ms: r.elapsed_ms,
      body_preview: r.body_preview,
    });
  } else {
    shaamError("preflight", `FAIL ${r.name}`, {
      elapsed_ms: r.elapsed_ms,
      detail: r.detail,
      cause_chain: r.cause_chain,
    });
  }
}

async function main() {
  const cfg = getShaamConfig();
  const proxy = getShaamProxyHostPort();
  const clearanceBaseUrl = getShaamClearanceBaseUrl();
  const invoicePath = getShaamInvoicePath();
  // OAuth and clearance live on different hosts in the v2.0 product
  // (openapi.taxes.gov.il vs ita-api.taxes.gov.il) and on unrelated
  // infrastructure — openapi on an Israeli ISP netblock, ita-api behind
  // Google Cloud. They are reachable independently, so we probe both:
  // one can pass while the other is blocked.
  shaamLog("preflight", "config", {
    environment: cfg.environment,
    oauth_base_url: cfg.baseUrl,
    clearance_base_url: clearanceBaseUrl,
    token_path: cfg.tokenPath,
    authorize_path: cfg.authorizePath,
    invoice_path: invoicePath,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope,
    client_id_present: Boolean(cfg.clientId),
    client_secret_present: Boolean(cfg.clientSecret),
    proxy: proxy ?? null,
  });

  if (!proxy) {
    shaamWarn(
      "preflight",
      "SHAAM_PROXY_URL is not set — proxy probes will run direct.",
    );
  }

  // 1. Direct egress sanity — does this host even have outbound https?
  summary(
    await probe("1. direct egress (api.ipify.org)", "https://api.ipify.org?format=json", {
      useProxy: false,
    }),
  );

  // 2. Deliberately a NON-ITA host. Against a domain-allowlisted proxy a
  //    refusal here is the pass condition; against an open proxy the 200
  //    reports the egress country. Judged by `summaryAllowlist`, not
  //    `summary` — see that function.
  if (proxy) {
    summaryAllowlist(
      await probe(
        "2. proxy → non-ITA host (domain allowlist check)",
        "https://lumtest.com/myip.json",
        { useProxy: true },
      ),
    );
  }

  // 3. Proxy → ITA OAuth host root. We don't care about the response
  //    body — a 404 / 403 / 200 all prove the TLS handshake completed
  //    through the proxy. A timeout / "Request was cancelled."
  //    means the proxy refused the CONNECT to that host:port.
  summary(
    await probe(
      "3. proxy → OAuth host (TLS handshake)",
      cfg.baseUrl,
      { useProxy: Boolean(proxy) },
    ),
  );

  // 4. Proxy → ITA token endpoint with an obviously-invalid body.
  //    Expect 4xx (invalid_request / unauthorized_client). Anything
  //    network-level here is the same blocker as the real flow.
  const tokenUrl = new URL(cfg.tokenPath, cfg.baseUrl).toString();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: "preflight-no-such-code",
    redirect_uri: cfg.redirectUri || "https://example.invalid/cb",
    client_id: cfg.clientId || "preflight-no-client",
    client_secret: cfg.clientSecret || "preflight-no-secret",
    code_verifier: "preflight-no-verifier",
  }).toString();
  summary(
    await probe("4. proxy → OAuth token endpoint", tokenUrl, {
      useProxy: Boolean(proxy),
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
      },
    }),
  );

  // 5. Proxy → ITA clearance host root. v2 split this onto a different
  //    subdomain (`ita-api.taxes.gov.il`), fronted by Google Cloud
  //    rather than ITA's own network. It therefore answers from egress
  //    addresses the OAuth host refuses — a pass on 5 with a fail on 3
  //    is the classic "looks healthy, OAuth is dead" shape.
  summary(
    await probe(
      "5. proxy → clearance host (TLS handshake)",
      clearanceBaseUrl,
      { useProxy: Boolean(proxy) },
    ),
  );

  // 6. Proxy → ITA clearance endpoint with a deliberately invalid
  //    bearer + empty body. Expect 401 / 422 / 4xx — i.e. ITA's
  //    application layer responded. Anything network-level here is
  //    the exact failure we see during real submission.
  const clearanceUrl = new URL(invoicePath, clearanceBaseUrl).toString();
  summary(
    await probe("6. proxy → clearance endpoint (POST)", clearanceUrl, {
      useProxy: Boolean(proxy),
      init: {
        method: "POST",
        headers: {
          Authorization: "Bearer preflight-no-such-token",
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": "preflight-idem-0000",
          "X-Correlation-Id": "preflight-corr-0000",
        },
        body: "{}",
      },
    }),
  );

  console.log(
    "\n[preflight] interpretation:\n" +
      "  - Probe 1 fails  → host has no outbound https; nothing else will work.\n" +
      "  - Probe 2 refused → EXPECTED with our squid; the domain allowlist works.\n" +
      "    Probe 2 returning 200 means the proxy is open to any host — fine for a\n" +
      "    vendor proxy, but our il-central-1 squid should refuse. Either way it\n" +
      "    says nothing about ITA reachability.\n" +
      "  - Probe 3/4 fails with 'Request was cancelled.' → the proxy could not reach\n" +
      "    openapi.taxes.gov.il. If the proxy is our own squid, check the egress IP\n" +
      "    range first: ITA drops some AWS il-central-1 ranges (16.164.0.0/16) and\n" +
      "    accepts others (51.16/51.84). See docs/ita-compliance/11-israel-egress.md.\n" +
      "    With a vendor proxy this is usually a gov-target CONNECT block instead.\n" +
      "  - Probe 3/4 ok but 5/6 fails → the clearance host (ita-api.taxes.gov.il) is\n" +
      "    independently blocked; it is fronted by Google Cloud while openapi is not,\n" +
      "    so they fail independently. Expect every v2 invoice POST to surface as\n" +
      "    `network_error` / `fetch failed` even though OAuth looks healthy.\n" +
      "  - Probe 6 returns 4xx JSON → proxy + DNS + TLS + auth gate all good; any\n" +
      "    real-flow failure is at the application layer (token / payload schema /\n" +
      "    JSV0001 etc.) and not network-level.",
  );
}

main().catch((err) => {
  shaamError("preflight", "fatal", {
    detail: err instanceof Error ? err.message : String(err),
    cause_chain: describeError(err),
  });
  process.exit(1);
});
