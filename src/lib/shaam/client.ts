/**
 * OAuth 2.0 client against openapi.taxes.gov.il (Spec 07).
 *
 * All endpoint paths + base URLs + scope are env-configurable because
 * the ITA docs shift between versions and the UAT vs PROD hostnames
 * are subject to the developer-portal configuration. See
 * docs/ita-compliance/KNOWN_ISSUES.md for the human pre-flight check.
 *
 * Every HTTP operation accepts an optional `fetchImpl` so the
 * verification harness (scripts/verify-shaam-oauth.ts) can stub
 * responses without reaching the network.
 */

import { ShaamApiError, ShaamAuthorizationError } from "./errors";
import type { ShaamEnvironment } from "@/db/schema/shaam-authorizations";
import type { ShaamInvoicePayload } from "./payload";
import { getShaamProxyHostPort, shaamFetch } from "./proxy";
import {
  describeError,
  prefix,
  redact,
  shaamError,
  shaamLog,
  shaamWarn,
} from "./debug";

export interface ShaamConfig {
  environment: ShaamEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizePath: string;
  tokenPath: string;
  revokePath: string;
  scope: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type: "Bearer";
}

export type FetchImpl = typeof fetch;

/** Override hook for tests. Set to `undefined` to restore the global. */
let fetchOverride: FetchImpl | undefined;
export function _setShaamFetchForTests(impl: FetchImpl | undefined): void {
  fetchOverride = impl;
}
function activeFetch(): FetchImpl {
  return fetchOverride ?? shaamFetch;
}

/**
 * Same resolver, exported so sibling modules (the decision service) share
 * one fetch hook. Without this a verify harness could swap the clearance
 * fetch and still make a real network call from the decision client.
 */
export function shaamActiveFetch(): FetchImpl {
  return activeFetch();
}

/**
 * Default clearance path — Israel Invoice Model API v2.0 (7/2024)
 * single-invoice approval. UAT uses `/tsandbox/`; production uses
 * `/production/`. Override via `SHAAM_INVOICE_PATH` if the developer
 * portal advertises a different route.
 */
const DEFAULT_INVOICE_PATH_UAT = "/shaam/tsandbox/Invoices/v2/Approval";
const DEFAULT_INVOICE_PATH_PROD = "/shaam/production/Invoices/v2/Approval";

export function getShaamInvoicePath(): string {
  if (process.env.SHAAM_INVOICE_PATH) return process.env.SHAAM_INVOICE_PATH;
  const environment = (process.env.SHAAM_ENV ?? "UAT").toUpperCase();
  return environment === "PROD"
    ? DEFAULT_INVOICE_PATH_PROD
    : DEFAULT_INVOICE_PATH_UAT;
}

/**
 * Clearance URL for a sandboxed entity that has a UAT grant.
 * Ignores a production invoice path so the request cannot land on
 * `/shaam/production/`.
 */
export function getShaamUatClearanceUrl(): string {
  const configured = process.env.SHAAM_INVOICE_PATH?.trim();
  const path =
    configured &&
    configured.includes("/tsandbox/") &&
    !configured.includes("/production/")
      ? configured
      : DEFAULT_INVOICE_PATH_UAT;
  const explicit = process.env.SHAAM_CLEARANCE_BASE_URL?.trim();
  const base =
    explicit ||
    process.env.SHAAM_BASE_URL_UAT?.trim() ||
    "https://ita-api.taxes.gov.il";
  return new URL(path, base).toString();
}

/**
 * Base URL used for the **clearance** endpoint specifically.
 *
 * v2.0 split the hosts: the clearance API moved to
 * `ita-api.taxes.gov.il`, but the OAuth authorization server stays on
 * `openapi.taxes.gov.il`. We therefore can't reuse `SHAAM_BASE_URL_*`
 * for both. `SHAAM_CLEARANCE_BASE_URL` overrides only the clearance
 * host; if unset, falls back to `SHAAM_BASE_URL_*` (preserves the
 * old single-host setup) and finally to the v2 default
 * `https://ita-api.taxes.gov.il`.
 */
export function getShaamClearanceBaseUrl(): string {
  const explicit = process.env.SHAAM_CLEARANCE_BASE_URL?.trim();
  if (explicit) return explicit;
  const environment = (process.env.SHAAM_ENV ?? "UAT").toUpperCase();
  const legacy =
    environment === "PROD"
      ? process.env.SHAAM_BASE_URL_PROD?.trim()
      : process.env.SHAAM_BASE_URL_UAT?.trim();
  if (legacy) return legacy;
  return "https://ita-api.taxes.gov.il";
}

export function getShaamConfig(): ShaamConfig {
  const environment = ((process.env.SHAAM_ENV ?? "UAT").toUpperCase() ===
  "PROD"
    ? "PROD"
    : "UAT") as ShaamEnvironment;
  // OAuth host — stays on openapi.taxes.gov.il in v2 even though
  // the clearance host moved (see getShaamClearanceBaseUrl).
  const baseUrl =
    environment === "PROD"
      ? process.env.SHAAM_BASE_URL_PROD ?? "https://openapi.taxes.gov.il"
      : process.env.SHAAM_BASE_URL_UAT ?? "https://openapi.taxes.gov.il";

  const clientId = process.env.SHAAM_CLIENT_ID ?? "";
  const clientSecret = process.env.SHAAM_CLIENT_SECRET ?? "";
  const redirectUri = process.env.SHAAM_REDIRECT_URI ?? "";

  return {
    environment,
    baseUrl,
    clientId,
    clientSecret,
    redirectUri,
    authorizePath: process.env.SHAAM_AUTHORIZE_PATH ?? "/oauth/authorize",
    tokenPath: process.env.SHAAM_TOKEN_PATH ?? "/oauth/token",
    revokePath: process.env.SHAAM_REVOKE_PATH ?? "/oauth/revoke",
    scope: process.env.SHAAM_OAUTH_SCOPE ?? "scope",
  };
}

export function assertShaamConfig(cfg: ShaamConfig = getShaamConfig()): void {
  const missing: string[] = [];
  if (!cfg.clientId) missing.push("SHAAM_CLIENT_ID");
  if (!cfg.clientSecret) missing.push("SHAAM_CLIENT_SECRET");
  if (!cfg.redirectUri) missing.push("SHAAM_REDIRECT_URI");
  if (missing.length > 0) {
    throw new Error(
      [
        `Cannot reach the Tax Authority: missing ${missing.join(", ")}.`,
        "",
        "These are the operating business's OWN credentials for the Israel Tax",
        "Authority invoice model (מודל חשבוניות ישראל). They are issued to the",
        "business when it is approved, they identify it to the Authority, and",
        "they cannot be shared or inherited from another deployment — including",
        "this project's.",
        "",
        "Until they are set, this instance cannot request allocation numbers",
        "(מספרי הקצאה), so it cannot issue documents above the threshold to",
        "third parties. Everything else works, and Israeli law permits a",
        "business to issue documents to itself in the meantime.",
        "",
        `Set ${missing.join(", ")} in the environment once approved.`,
        "`.env.example` documents each variable.",
      ].join("\n"),
    );
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];
const RETRY_AFTER_CEILING_MS = 60_000;

/**
 * Snapshot headers that help classify CDN / WAF / rate-limit behaviour.
 */
export function shaamEdgeAndRateHeaders(
  response: Response,
): Record<string, string | null> {
  const h = response.headers;
  const out: Record<string, string | null> = {
    via: h.get("via"),
    server: h.get("server"),
    "x-cache": h.get("x-cache"),
    "cf-ray": h.get("cf-ray"),
    "x-amz-cf-id": h.get("x-amz-cf-id"),
    "content-type": h.get("content-type"),
    "retry-after": h.get("retry-after"),
    "www-authenticate": h.get("www-authenticate"),
  };
  h.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-ratelimit-")) {
      out[lower] = value;
    }
  });
  return out;
}

function parseRetryAfterDelayMs(
  header: string | null,
  ceilingMs: number,
): number | null {
  if (!header) return null;
  const t = header.trim();
  if (/^\d+$/.test(t)) {
    const sec = parseInt(t, 10);
    if (!Number.isFinite(sec) || sec < 0) return null;
    return Math.min(sec * 1000, ceilingMs);
  }
  const when = Date.parse(t);
  if (!Number.isNaN(when)) {
    const delta = when - Date.now();
    if (delta <= 0) return null;
    return Math.min(delta, ceilingMs);
  }
  return null;
}

/**
 * POST form-encoded body to a SHAAM OAuth endpoint with retries on
 * network errors, 5xx responses, and **429** (honouring `Retry-After`
 * when present, capped at 60s; otherwise fixed backoff). Returns the
 * parsed JSON on 2xx; throws `ShaamApiError` on other 4xx or a
 * terminal 5xx / 429.
 */
async function postForm<T>(
  url: string,
  body: Record<string, string>,
): Promise<T> {
  const params = new URLSearchParams(body);
  const proxy = getShaamProxyHostPort();
  // grant_type identifies the OAuth operation; safe to log.
  const grantType = body.grant_type ?? body.token_type_hint ?? "unknown";
  // Body keys + redacted lengths — no plaintext secrets.
  const bodySummary: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    bodySummary[k] =
      k === "client_id" || k === "redirect_uri" || k === "scope"
        ? v
        : k === "code" || k === "code_verifier"
          ? prefix(v, 6)
          : redact(v);
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    shaamLog("oauth.post", "request", {
      url,
      grant_type: grantType,
      attempt: attempt + 1,
      max_attempts: MAX_ATTEMPTS,
      proxy: proxy ?? null,
      body: bodySummary,
    });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );
      let response: Response;
      try {
        response = await activeFetch()(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: params.toString(),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const elapsedMs = Date.now() - started;
      const requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("x-amzn-requestid") ??
        null;

      if (response.ok) {
        shaamLog("oauth.post", "response ok", {
          url,
          grant_type: grantType,
          status: response.status,
          elapsed_ms: elapsedMs,
          request_id: requestId,
        });
        return (await response.json()) as T;
      }

      const text = await response.text().catch(() => "");
      const edgeHeaders = shaamEdgeAndRateHeaders(response);

      if (response.status === 429 && attempt < MAX_ATTEMPTS - 1) {
        const ra = response.headers.get("retry-after");
        const fromHeader = parseRetryAfterDelayMs(ra, RETRY_AFTER_CEILING_MS);
        const delayMs = fromHeader ?? (BACKOFF_MS[attempt] ?? 4_000);
        shaamWarn("oauth.post", "response 429 — will retry", {
          url,
          grant_type: grantType,
          status: response.status,
          attempt: attempt + 1,
          max_attempts: MAX_ATTEMPTS,
          elapsed_ms: elapsedMs,
          request_id: requestId,
          retry_after_header: ra,
          delay_ms: delayMs,
          edge_headers: edgeHeaders,
          body_preview: text.slice(0, 200),
        });
        await sleep(delayMs);
        continue;
      }

      if (response.status >= 500 && attempt < MAX_ATTEMPTS - 1) {
        shaamWarn("oauth.post", "response 5xx — will retry", {
          url,
          status: response.status,
          attempt: attempt + 1,
          elapsed_ms: elapsedMs,
          request_id: requestId,
          body_preview: text.slice(0, 200),
          edge_headers: edgeHeaders,
        });
        await sleep(BACKOFF_MS[attempt] ?? 4_000);
        continue;
      }
      const parsed = safeParseJson(text);
      const errorCode = (parsed?.error as string | undefined) ?? null;
      const errorMessage =
        (parsed?.error_description as string | undefined) ??
        (parsed?.message as string | undefined) ??
        text.slice(0, 200) ??
        null;
      shaamError("oauth.post", "response error", {
        url,
        grant_type: grantType,
        status: response.status,
        elapsed_ms: elapsedMs,
        request_id: requestId,
        error_code: errorCode,
        error_message: errorMessage,
        edge_headers: edgeHeaders,
      });
      throw new ShaamApiError(
        response.status,
        errorCode,
        errorMessage,
        requestId,
      );
    } catch (err) {
      if (err instanceof ShaamApiError) throw err;
      lastErr = err;
      const elapsedMs = Date.now() - started;
      shaamWarn("oauth.post", "network/abort error", {
        url,
        grant_type: grantType,
        attempt: attempt + 1,
        elapsed_ms: elapsedMs,
        proxy: proxy ?? null,
        cause_chain: describeError(err),
      });
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_MS[attempt] ?? 4_000);
        continue;
      }
    }
  }
  const baseMessage =
    lastErr instanceof Error ? lastErr.message : String(lastErr);
  shaamError("oauth.post", "all attempts failed", {
    url,
    grant_type: grantType,
    proxy: proxy ?? null,
    message: baseMessage,
  });
  throw new ShaamApiError(
    0,
    "network_error",
    proxy ? `[via proxy ${proxy}] ${baseMessage}` : baseMessage,
    null,
  );
}

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return typeof v === "object" && v !== null
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Construct the `Location` URL a browser should hit to complete the
 * authorization flow. Pure; no network.
 */
export function buildAuthorizationUrl(params: {
  state: string;
  codeChallenge: string;
  config?: ShaamConfig;
}): string {
  const cfg = params.config ?? getShaamConfig();
  const url = new URL(cfg.authorizePath, cfg.baseUrl);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  const built = url.toString();
  shaamLog("oauth.authorize_url", "built", {
    environment: cfg.environment,
    base_url: cfg.baseUrl,
    authorize_path: cfg.authorizePath,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope,
    client_id_present: Boolean(cfg.clientId),
    state_prefix: prefix(params.state, 8),
    url: built,
  });
  return built;
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
  config?: ShaamConfig;
}): Promise<TokenResponse> {
  const cfg = params.config ?? getShaamConfig();
  assertShaamConfig(cfg);
  const url = new URL(cfg.tokenPath, cfg.baseUrl).toString();
  return postForm<TokenResponse>(url, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: params.codeVerifier,
  });
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  config?: ShaamConfig;
}): Promise<TokenResponse> {
  const cfg = params.config ?? getShaamConfig();
  assertShaamConfig(cfg);
  const url = new URL(cfg.tokenPath, cfg.baseUrl).toString();
  return postForm<TokenResponse>(url, {
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: cfg.scope,
  });
}

export async function revokeToken(params: {
  token: string;
  tokenTypeHint: "access_token" | "refresh_token";
  config?: ShaamConfig;
}): Promise<void> {
  const cfg = params.config ?? getShaamConfig();
  assertShaamConfig(cfg);
  const url = new URL(cfg.revokePath, cfg.baseUrl).toString();
  try {
    await postForm<Record<string, unknown>>(url, {
      token: params.token,
      token_type_hint: params.tokenTypeHint,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
  } catch (err) {
    // Revocation is best-effort — RFC 7009 says servers SHOULD return
    // 200 even for unknown tokens. Anything non-200 we swallow; the
    // caller has already flipped the DB row to REVOKED.
    if (err instanceof ShaamApiError) return;
    throw err;
  }
}

/**
 * Log-safe rendering of a token response: redacts the actual token
 * values and keeps metadata for the token-events table.
 */
export function sanitizeTokenResponseForLogging(
  response: TokenResponse,
): Record<string, unknown> {
  return {
    token_type: response.token_type,
    expires_in: response.expires_in,
    scope: response.scope,
    access_token: "[redacted]",
    refresh_token: "[redacted]",
  };
}

// ---------------------------------------------------------------------------
// Spec 08 — invoice clearance submission
// ---------------------------------------------------------------------------

export type ShaamSubmitResult =
  | {
      result: "APPROVED";
      allocationNumber: string;
      requestId: string | null;
      httpStatus: number;
      elapsedMs: number;
      rawResponse: unknown;
    }
  | {
      result: "REJECTED";
      errorCode: string;
      errorMessage: string;
      requestId: string | null;
      httpStatus: number;
      elapsedMs: number;
      rawResponse: unknown;
    }
  | {
      result: "HELD";
      errorCode: string;
      errorMessage: string;
      hearingDeadline: Date | null;
      requestId: string | null;
      httpStatus: number;
      elapsedMs: number;
      rawResponse: unknown;
    }
  | { result: "TIMEOUT"; elapsedMs: number }
  | { result: "NETWORK_ERROR"; cause: Error; elapsedMs: number };

const DEFAULT_SUBMIT_TIMEOUT_MS = 15_000;

export async function submitInvoice(params: {
  accessToken: string;
  payload: ShaamInvoicePayload;
  idempotencyKey: string;
  correlationId: string;
  timeoutMs?: number;
  config?: ShaamConfig;
  /** When set, this exact URL is posted. Sandbox UAT uses this so a production path cannot be selected. */
  clearanceUrl?: string;
}): Promise<ShaamSubmitResult> {
  // v2 hosts clearance on a different domain than OAuth, so we use a
  // dedicated `getShaamClearanceBaseUrl()` here rather than the config's
  // `baseUrl` (which is the OAuth host). `params.config` is accepted for
  // API-shape parity with the test harness even though it's no longer
  // consulted for the URL.
  void params.config;
  const url =
    params.clearanceUrl ??
    new URL(getShaamInvoicePath(), getShaamClearanceBaseUrl()).toString();
  const timeout = params.timeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const proxy = getShaamProxyHostPort();
  const payloadBody = JSON.stringify(params.payload);

  shaamLog("clearance.submit", "request", {
    url,
    idempotency_key: params.idempotencyKey,
    correlation_id: params.correlationId,
    proxy: proxy ?? null,
    payload_bytes: payloadBody.length,
    invoice_type: params.payload.invoice_type,
    user_id_present: Boolean(params.payload.user_id),
  });

  let response: Response;
  try {
    response = await activeFetch()(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": params.idempotencyKey,
        "X-Correlation-Id": params.correlationId,
      },
      body: payloadBody,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - started;
    if (controller.signal.aborted) {
      shaamWarn("clearance.submit", "request timeout", {
        url,
        elapsed_ms: elapsed,
        timeout_ms: timeout,
        proxy: proxy ?? null,
      });
      return { result: "TIMEOUT", elapsedMs: elapsed };
    }
    const cause = err instanceof Error ? err : new Error(String(err));
    if (proxy) {
      cause.message = `[via proxy ${proxy}] ${cause.message}`;
    }
    // Always log network/abort errors to stderr (not gated by
    // SHAAM_DEBUG) — undici collapses proxy CONNECT failures and
    // socket errors to a vague "fetch failed", and the only place
    // the actual cause (e.g. `Proxy response (403) !== 200 when HTTP
    // Tunneling`, `UND_ERR_CONNECT_TIMEOUT`) is recoverable from is
    // the `.cause` chain on the Error object at this exact spot.
    shaamError("clearance.submit", "network/abort error", {
      url,
      elapsed_ms: elapsed,
      proxy: proxy ?? null,
      cause_chain: describeError(err),
    });
    return { result: "NETWORK_ERROR", cause, elapsedMs: elapsed };
  }
  clearTimeout(timer);

  const elapsedMs = Date.now() - started;
  const text = await response.text().catch(() => "");
  const parsed = safeParseJson(text);
  const requestId =
    response.headers.get("x-correlation-id") ??
    response.headers.get("x-request-id") ??
    (parsed?.requestId as string | undefined) ??
    null;
  // Snapshot edge-relevant response headers for the error logs.
  // These are what surface CDN / WAF blocks in front of ITA — e.g.
  // `via: 1.1 google` reveals a Google Cloud Load Balancer / Cloud
  // Armor reject before the ITA backend is reached, which is
  // diagnostically critical and otherwise invisible in our logs.
  const edgeHeaders = shaamEdgeAndRateHeaders(response);

  // 401 → auth is expired or token is bad. Caller flips the
  // shaam_authorizations row to EXPIRED and marks the document
  // PENDING so the next retry picks up after re-authorization.
  if (response.status === 401) {
    const errCode = (parsed?.error as string | undefined) ?? "unauthorized";
    const errMsg =
      (parsed?.error_description as string | undefined) ??
      (parsed?.message as string | undefined) ??
      null;
    shaamWarn("clearance.submit", "response 401 unauthorized", {
      url,
      status: 401,
      elapsed_ms: elapsedMs,
      request_id: requestId,
      error_code: errCode,
      error_message: errMsg,
      edge_headers: edgeHeaders,
    });
    throw new ShaamAuthorizationError(
      "expired",
      "(caller-supplies-business-entity-id)",
      new ShaamApiError(401, errCode, errMsg, requestId),
    );
  }

  // v2 returns 200 OK for *both* approvals AND substantive rejections —
  // the discriminator is the `approved` boolean and the error codes in
  // `message.errors[]`. Per spec §2.2 (Israel Invoice Model 7/2024):
  //   approved=true                 → APPROVED with `confirmation_number`
  //   approved=false + code 460     → HELD (unapproved, no decision yet)
  //   approved=false + code 461     → HELD (unapproved invoice exists, no decision)
  //   approved=false + code 462     → REJECTED (unapproved + decision sent — terminal)
  //   approved=false + other        → REJECTED (validation / business rule)
  if (response.ok) {
    const approved = parsed?.approved;
    const errors = extractV2Errors(parsed);
    const primaryError = errors[0] ?? null;
    if (approved === true) {
      const allocationNumber = extractAllocationNumber(parsed, text);
      if (allocationNumber) {
        shaamLog("clearance.submit", "response approved", {
          url,
          status: response.status,
          elapsed_ms: elapsedMs,
          request_id: requestId,
          allocation_number_prefix: prefix(allocationNumber, 6),
        });
        return {
          result: "APPROVED",
          allocationNumber,
          requestId,
          httpStatus: response.status,
          elapsedMs,
          rawResponse: parsed ?? text,
        };
      }
      // 200 + approved=true but no parseable allocation number — surface
      // as HELD so the admin UI flags the anomaly rather than silently
      // dropping it.
      shaamWarn("clearance.submit", "response approved without allocation", {
        url,
        status: response.status,
        elapsed_ms: elapsedMs,
        request_id: requestId,
        body_preview: text.slice(0, 300),
        edge_headers: edgeHeaders,
      });
      return {
        result: "HELD",
        errorCode: "no_allocation_number",
        errorMessage:
          "SHAAM returned approved=true without a recognisable confirmation_number; see rawResponse",
        hearingDeadline: null,
        requestId,
        httpStatus: response.status,
        elapsedMs,
        rawResponse: parsed ?? text,
      };
    }
    // approved=false — soft-rejection / hold. Pick HELD vs REJECTED
    // based on the v2 error code (462 is terminal; 460/461 await a
    // hearing decision).
    const errCode = primaryError?.code != null ? String(primaryError.code) : null;
    const errMessage =
      primaryError?.message ??
      (typeof parsed?.message === "string" ? (parsed.message as string) : null) ??
      "Invoice not approved";
    // Only 462 is documented as terminal. An unrecognised code used to
    // land here as REJECTED too, which closes off the retry path and tells
    // the seller the refusal is final when we do not actually know that.
    // Unknown means "we cannot tell yet", which is what HELD encodes.
    const isTerminal = errCode === "462";
    if (isTerminal) {
      shaamError("clearance.submit", "response rejected (terminal v2 462)", {
        url,
        status: response.status,
        elapsed_ms: elapsedMs,
        request_id: requestId,
        error_code: errCode,
        error_message: errMessage,
        body_preview: text.slice(0, 300),
        edge_headers: edgeHeaders,
      });
      return {
        result: "REJECTED",
        errorCode: errCode,
        errorMessage: errMessage,
        requestId,
        httpStatus: response.status,
        elapsedMs,
        rawResponse: parsed ?? text,
      };
    }
    shaamWarn("clearance.submit", "response held (v2 460/461)", {
      url,
      status: response.status,
      elapsed_ms: elapsedMs,
      request_id: requestId,
      error_code: errCode ?? "held",
      error_message: errMessage,
      edge_headers: edgeHeaders,
    });
    return {
      result: "HELD",
      errorCode: errCode ?? "held",
      errorMessage: errMessage,
      hearingDeadline: extractHearingDeadline(parsed),
      requestId,
      httpStatus: response.status,
      elapsedMs,
      rawResponse: parsed ?? text,
    };
  }

  // 409 → HELD. v2.0 puts the hearing deadline in the body.
  if (response.status === 409) {
    const deadline = extractHearingDeadline(parsed);
    const errCode =
      (parsed?.errorCode as string | undefined) ??
      (parsed?.error as string | undefined) ??
      "held";
    const errMsg =
      (parsed?.errorMessage as string | undefined) ??
      (parsed?.message as string | undefined) ??
      "Held for ITA review";
    shaamWarn("clearance.submit", "response 409 held", {
      url,
      status: 409,
      elapsed_ms: elapsedMs,
      request_id: requestId,
      error_code: errCode,
      error_message: errMsg,
      hearing_deadline: deadline?.toISOString() ?? null,
      edge_headers: edgeHeaders,
    });
    return {
      result: "HELD",
      errorCode: errCode,
      errorMessage: errMsg,
      hearingDeadline: deadline,
      requestId,
      httpStatus: response.status,
      elapsedMs,
      rawResponse: parsed ?? text,
    };
  }

  // 4xx other than 401/409 → REJECTED with a specific error code.
  // 5xx falls through here too and `recordResult` promotes it to
  // OUTAGE_ISSUED, since a failing ITA server is an outage rather than a
  // refusal. (That promotion is real now — this comment used to describe
  // it while nothing actually did it.)
  // v2 puts errors in `message.errors[]`; v1 used flat `error` /
  // `errorCode` fields. Try v2 first, then fall back to v1.
  const v2Errors = extractV2Errors(parsed);
  const primaryV2 = v2Errors[0];
  const finalErrorCode =
    (primaryV2?.code != null ? String(primaryV2.code) : null) ??
    (parsed?.errorCode as string | undefined) ??
    (parsed?.error as string | undefined) ??
    `http_${response.status}`;
  const finalErrorMessage =
    primaryV2?.message ??
    (parsed?.errorMessage as string | undefined) ??
    (typeof parsed?.message === "string"
      ? (parsed.message as string)
      : undefined) ??
    (parsed?.moreInformation as string | undefined) ??
    text.slice(0, 500) ??
    "";
  // Always log non-2xx as an error — this is where edge / WAF / CDN
  // blocks (e.g. Cloud Armor `via: 1.1 google` 403, Akamai reference
  // page) and ITA backend errors all surface. Body preview is
  // truncated; edge headers are critical for diagnosing whether the
  // 4xx came from ITA's app (JSON body, request_id present) or from
  // a CDN in front of it (HTML body, no request_id, edge `via` set).
  shaamError("clearance.submit", "response error", {
    url,
    status: response.status,
    elapsed_ms: elapsedMs,
    request_id: requestId,
    error_code: finalErrorCode,
    error_message: finalErrorMessage,
    body_preview: text.slice(0, 300),
    edge_headers: edgeHeaders,
    parsed_is_json: parsed !== null,
  });
  return {
    result: "REJECTED",
    errorCode: finalErrorCode,
    errorMessage: finalErrorMessage,
    requestId,
    httpStatus: response.status,
    elapsedMs,
    rawResponse: parsed ?? text,
  };
}

interface V2ErrorEntry {
  code?: string | number;
  message?: string;
  param?: string;
  location?: string;
}

/**
 * Pull the v2 error list out of `parsed.message.errors[]` if present.
 *
 * v2 wraps errors in a nested object both for 200-with-rejection and
 * for 4xx responses. Returns an empty array if the shape doesn't match —
 * callers fall through to v1-style flat fields.
 */
/**
 * The hearing deadline (מועד השימוע) the ITA returns with a hold.
 *
 * This value is the seller's clock: the hearing runs on a short statutory
 * window, and a hold the ITA does not decide within it can end in the
 * allocation being granted by default. Losing the date means the seller
 * cannot tell whether that window is still open, so we take it from
 * whichever spelling the response uses rather than only the 409 body.
 */
function extractHearingDeadline(parsed: Record<string, unknown> | null): Date | null {
  if (!parsed) return null;
  const raw =
    (parsed.hearingDeadline as string | undefined) ??
    (parsed.hearing_deadline as string | undefined) ??
    (parsed.hearingDate as string | undefined) ??
    (parsed.hearing_date as string | undefined) ??
    null;
  if (!raw) return null;
  const parsedDate = new Date(raw);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function extractV2Errors(
  parsed: Record<string, unknown> | null,
): V2ErrorEntry[] {
  if (!parsed) return [];
  const message = parsed.message;
  if (typeof message !== "object" || message === null) return [];
  const errors = (message as Record<string, unknown>).errors;
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (e): e is V2ErrorEntry => typeof e === "object" && e !== null,
  );
}

function extractAllocationNumber(
  parsed: Record<string, unknown> | null,
  rawText: string,
): string | null {
  // v2 returns `confirmation_number` (typically 25 digits); v1 used
  // various names. Accept any all-digit string of 9..32 chars; `0`
  // (and any other non-allocation placeholder) is rejected explicitly.
  const candidates = [
    parsed?.confirmation_number,
    parsed?.confirmationNumber,
    parsed?.allocationNumber,
    parsed?.allocation_number,
    parsed?.approvalNumber,
    parsed?.approval_number,
    parsed?.allocationID,
  ];
  const isAllocation = (s: string): boolean =>
    /^\d{9,32}$/.test(s) && s !== "0" && /[1-9]/.test(s);
  for (const c of candidates) {
    if (typeof c === "string" && isAllocation(c)) return c;
    if (typeof c === "number" && isAllocation(String(c))) return String(c);
  }
  // Fallback: search the raw body for a standalone long digit run.
  // Prefer 25-digit (v2) over 9-digit (v1) when both appear.
  const match25 = rawText.match(/(^|[^0-9])(\d{25})([^0-9]|$)/);
  if (match25 && /[1-9]/.test(match25[2])) {
    console.warn(
      "[shaam] confirmation number extracted via 25-digit regex fallback — verify ITA v2.0 response field and update extractAllocationNumber.",
    );
    return match25[2];
  }
  const match = rawText.match(/(^|[^0-9])(\d{9})([^0-9]|$)/);
  if (match) {
    console.warn(
      "[shaam] allocation number extracted via regex fallback — verify ITA v2.0 response field and update extractAllocationNumber.",
    );
    return match[2];
  }
  return null;
}
