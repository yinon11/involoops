/**
 * ITA "Decision update service regarding an invoice that was held"
 * (v2.0 spec §4) — telling the Tax Authority which of the four statutory
 * alternatives the seller chose after a hold or refusal.
 *
 * The spec is explicit that this is not optional:
 *
 *   "The software manufacturers will present the user with 4 alternatives
 *    to continue the process on the invoice and will update the tax
 *    authority of the user's decision.
 *    If alternatives 1, 2, 4 are selected, the service described in 4.2
 *    must be activated."
 *
 * We shipped all four alternatives and notified for none of them. See
 * `docs/ita-compliance/spec-audit-v2.md` §1.
 *
 * Alternative 3 (reverse charge) is deliberately absent here: the spec
 * routes it through the Approval service with `action=3`, not through
 * this one.
 */

import { getShaamClearanceBaseUrl, shaamActiveFetch } from "./client";
import { getShaamProxyHostPort } from "./proxy";
import { shaamError, shaamLog, shaamWarn } from "./debug";

/** Alternatives 1, 2 and 4 from §2.2.2, in the spec's own endpoint names. */
export const SHAAM_DECISIONS = ["Cancel", "Continue", "FurtherObjection"] as const;
export type ShaamDecision = (typeof SHAAM_DECISIONS)[number];

const DEFAULT_DECISION_BASE_UAT = "/shaam/tsandbox/InvoiceDecisionApi/v1";
const DEFAULT_DECISION_BASE_PROD = "/shaam/production/InvoiceDecisionApi/v1";

const DEFAULT_DECISION_TIMEOUT_MS = 15_000;

/**
 * Path prefix for the decision service. Mirrors `getShaamInvoicePath`:
 * `SHAAM_DECISION_PATH` overrides, otherwise the environment picks.
 */
export function getShaamDecisionPathPrefix(): string {
  const configured = process.env.SHAAM_DECISION_PATH?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const environment = (process.env.SHAAM_ENV ?? "UAT").toUpperCase();
  return environment === "PROD"
    ? DEFAULT_DECISION_BASE_PROD
    : DEFAULT_DECISION_BASE_UAT;
}

export function getShaamDecisionUrl(decision: ShaamDecision): string {
  const prefix = getShaamDecisionPathPrefix();
  return new URL(`${prefix}/${decision}`, getShaamClearanceBaseUrl()).toString();
}

/**
 * Sandbox-safe URL. Same guard as `getShaamUatClearanceUrl`: a configured
 * production path is ignored so a sandboxed entity cannot post to
 * `/shaam/production/`.
 */
export function getShaamUatDecisionUrl(decision: ShaamDecision): string {
  const configured = process.env.SHAAM_DECISION_PATH?.trim();
  const prefix =
    configured &&
    configured.includes("/tsandbox/") &&
    !configured.includes("/production/")
      ? configured.replace(/\/$/, "")
      : DEFAULT_DECISION_BASE_UAT;
  const base =
    process.env.SHAAM_CLEARANCE_BASE_URL?.trim() ||
    process.env.SHAAM_BASE_URL_UAT?.trim() ||
    "https://ita-api.taxes.gov.il";
  return new URL(`${prefix}/${decision}`, base).toString();
}

/**
 * Request body, Table 4.1. Every field is one `buildShaamPayload` already
 * produces for the clearance call — the decision service takes a subset of
 * the same identity fields plus the invoice id.
 */
export interface ShaamDecisionPayload {
  /** Uniform file field 1243. Must match the original clearance request. */
  invoice_id: string;
  /** Issuer's licensed dealer number (N9). */
  vat_number: number;
  accounting_software_number?: number;
  authorized_company?: number;
  user_id?: number;
  user_name?: string;
}

export type ShaamDecisionResult =
  | { result: "ACCEPTED"; httpStatus: number; elapsedMs: number; rawResponse: unknown }
  | {
      result: "REJECTED";
      errorCode: string | null;
      errorMessage: string;
      httpStatus: number;
      elapsedMs: number;
      rawResponse: unknown;
    }
  | { result: "TIMEOUT"; elapsedMs: number }
  | { result: "NETWORK_ERROR"; cause: Error; elapsedMs: number };

/**
 * Report the seller's choice.
 *
 * Deliberately never throws for a non-2xx: a failure to *notify* must not
 * undo a decision the seller already made and that we already recorded
 * locally. The caller records the outcome and moves on; a missed
 * notification is a reconciliation problem, not a reason to strand the
 * document a second time.
 */
export async function submitDecision(params: {
  accessToken: string;
  decision: ShaamDecision;
  payload: ShaamDecisionPayload;
  correlationId: string;
  timeoutMs?: number;
  /** When set, this exact URL is posted (sandbox entities pass the UAT URL). */
  decisionUrl?: string;
}): Promise<ShaamDecisionResult> {
  const url = params.decisionUrl ?? getShaamDecisionUrl(params.decision);
  const timeout = params.timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const proxy = getShaamProxyHostPort();
  const body = JSON.stringify(params.payload);

  shaamLog("decision.submit", "request", {
    url,
    decision: params.decision,
    correlation_id: params.correlationId,
    proxy: proxy ?? null,
    payload_bytes: body.length,
  });

  let response: Response;
  try {
    response = await shaamActiveFetch()(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Correlation-Id": params.correlationId,
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - started;
    if (controller.signal.aborted) {
      shaamWarn("decision.submit", "request timeout", {
        url,
        decision: params.decision,
        elapsed_ms: elapsed,
        timeout_ms: timeout,
      });
      return { result: "TIMEOUT", elapsedMs: elapsed };
    }
    const cause = err instanceof Error ? err : new Error(String(err));
    if (proxy) cause.message = `[via proxy ${proxy}] ${cause.message}`;
    shaamError("decision.submit", "network/abort error", {
      url,
      decision: params.decision,
      elapsed_ms: elapsed,
      proxy: proxy ?? null,
    });
    return { result: "NETWORK_ERROR", cause, elapsedMs: elapsed };
  }
  clearTimeout(timer);

  const elapsedMs = Date.now() - started;
  const text = await response.text().catch(() => "");
  const parsed = safeParse(text);

  if (response.ok) {
    shaamLog("decision.submit", "accepted", {
      url,
      decision: params.decision,
      status: response.status,
      elapsed_ms: elapsedMs,
    });
    return {
      result: "ACCEPTED",
      httpStatus: response.status,
      elapsedMs,
      rawResponse: parsed ?? text,
    };
  }

  // §4.2 shows the failure shape as the same nested `message.errors[]` the
  // clearance API uses — e.g. 463 "No matching unapproved invoice found".
  const errors = Array.isArray(
    (parsed?.message as { errors?: unknown[] } | undefined)?.errors,
  )
    ? ((parsed!.message as { errors: Array<{ code?: unknown; message?: unknown }> })
        .errors ?? [])
    : [];
  const primary = errors[0];
  const errorCode = primary?.code != null ? String(primary.code) : null;
  const errorMessage =
    (typeof primary?.message === "string" ? primary.message : null) ??
    (typeof parsed?.message === "string" ? (parsed.message as string) : null) ??
    text.slice(0, 300) ??
    "Decision not accepted";

  shaamError("decision.submit", "rejected", {
    url,
    decision: params.decision,
    status: response.status,
    elapsed_ms: elapsedMs,
    error_code: errorCode,
    error_message: errorMessage,
  });

  return {
    result: "REJECTED",
    errorCode,
    errorMessage,
    httpStatus: response.status,
    elapsedMs,
    rawResponse: parsed ?? text,
  };
}

function safeParse(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
