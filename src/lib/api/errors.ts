import { NextResponse } from "next/server";

/**
 * RFC 7807 Problem Details builder for the public REST API.
 * See docs/api/02-conventions.md for the error catalog.
 */

export type ApiErrorCode =
  | "bad_request"
  | "malformed_json"
  | "missing_credentials"
  | "invalid_key"
  | "expired_key"
  | "missing_scope"
  | "ita_approval_required"
  | "ip_not_allowed"
  | "tenant_mismatch"
  | "not_found"
  | "conflict"
  | "period_locked"
  | "document_immutable"
  | "cannot_void_document_type"
  | "idempotency_replay_mismatch"
  | "unsupported_media_type"
  | "validation_failed"
  | "currency_mismatch"
  | "shaam_rejected"
  | "shaam_held"
  | "tls_required"
  | "rate_limited"
  | "quota_exceeded"
  | "concurrency_exceeded"
  | "issue_path_busy"
  | "internal_error"
  | "upstream_unavailable";

const DOCS_BASE = "https://docs.involoops.com/api/errors";

export interface ApiErrorOptions {
  code: ApiErrorCode;
  status: number;
  title: string;
  detail?: string;
  errors?: { path: string; message: string }[];
  headers?: Record<string, string>;
  /** Structured, code-specific extras (e.g. the SHAAM statutory options). */
  meta?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly errors?: { path: string; message: string }[];
  readonly headers?: Record<string, string>;
  readonly meta?: Record<string, unknown>;

  constructor(opts: ApiErrorOptions) {
    super(opts.detail ?? opts.title);
    this.code = opts.code;
    this.status = opts.status;
    this.title = opts.title;
    this.detail = opts.detail;
    this.errors = opts.errors;
    this.headers = opts.headers;
    this.meta = opts.meta;
  }
}

export function problemResponse(err: ApiError, requestId: string): NextResponse {
  const body: Record<string, unknown> = {
    type: `${DOCS_BASE}/${err.code}`,
    title: err.title,
    status: err.status,
    code: err.code,
    request_id: requestId,
  };
  if (err.detail) body.detail = err.detail;
  if (err.errors && err.errors.length > 0) body.errors = err.errors;
  if (err.meta && Object.keys(err.meta).length > 0) body.meta = err.meta;

  const headers = new Headers({
    "content-type": "application/problem+json; charset=utf-8",
    "x-request-id": requestId,
    ...(err.headers ?? {}),
  });

  return new NextResponse(JSON.stringify(body), {
    status: err.status,
    headers,
  });
}

// Common builders — keep these small and obvious.

export const apiErrors = {
  missingCredentials: () =>
    new ApiError({
      code: "missing_credentials",
      status: 401,
      title: "Missing API credentials",
      detail: "Provide an Authorization: Bearer <api-key> header.",
      headers: { "www-authenticate": 'Bearer realm="involoops-api"' },
    }),
  invalidKey: () =>
    new ApiError({
      code: "invalid_key",
      status: 401,
      title: "Invalid API key",
    }),
  expiredKey: () =>
    new ApiError({
      code: "expired_key",
      status: 401,
      title: "API key has expired",
    }),
  missingScope: (required: string[], have: string[]) =>
    new ApiError({
      code: "missing_scope",
      status: 403,
      title: "Insufficient API key scope",
      detail: `Required: ${required.join(", ")}. Have: ${have.join(", ") || "(none)"}.`,
    }),
  notFound: (resource = "Resource") =>
    new ApiError({
      code: "not_found",
      status: 404,
      title: `${resource} not found`,
    }),
  malformedJson: () =>
    new ApiError({
      code: "malformed_json",
      status: 400,
      title: "Body is not valid JSON",
    }),
  unsupportedMediaType: () =>
    new ApiError({
      code: "unsupported_media_type",
      status: 415,
      title: "Content-Type must be application/json",
    }),
  tlsRequired: () =>
    new ApiError({
      code: "tls_required",
      status: 426,
      title: "TLS required",
      detail: "The public API only accepts requests over HTTPS.",
      headers: { upgrade: "TLS/1.2, HTTP/1.1" },
    }),
  validationFailed: (errors: { path: string; message: string }[]) =>
    new ApiError({
      code: "validation_failed",
      status: 422,
      title: "Request body failed validation",
      errors,
    }),
  rateLimited: (retryAfterSec: number, detail?: string) =>
    new ApiError({
      code: "rate_limited",
      status: 429,
      title: "Too many requests",
      detail,
      headers: { "retry-after": String(retryAfterSec) },
    }),
  idempotencyReplayMismatch: () =>
    new ApiError({
      code: "idempotency_replay_mismatch",
      status: 409,
      title: "Idempotency-Key reused with a different request body",
      detail:
        "The same Idempotency-Key was previously used for a different request. Use a new key for a new intent.",
    }),
  internal: (detail?: string) =>
    new ApiError({
      code: "internal_error",
      status: 500,
      title: "Internal server error",
      detail,
    }),
};

/**
 * A refusal from רשות המסים is a business outcome, not a server fault.
 * It used to fall through to the catch-all below and surface as HTTP 500,
 * which told integrators we had crashed when in fact the Tax Authority had
 * declined the allocation — and gave them nothing to branch on.
 *
 * 422 carries the ITA's own code and message plus the statutory options
 * that apply, so a caller can present the same choice the web UI does.
 */
export function shaamRefusalApiError(result: {
  shaamRejection?: "REJECTED" | "HELD";
  shaamErrorCode?: string | null;
  shaamRejectionKind?: string;
  shaamRejectionOptions?: string[];
  shaamHearingDeadline?: string | null;
  error: string;
}): ApiError {
  const held = result.shaamRejection === "HELD";
  return new ApiError({
    code: held ? "shaam_held" : "shaam_rejected",
    status: 422,
    title: held
      ? "The Tax Authority has not decided on this invoice"
      : "The Tax Authority did not allocate a number",
    detail: [
      result.shaamErrorCode ? `[${result.shaamErrorCode}]` : null,
      result.error,
      result.shaamRejectionOptions?.length
        ? `Available options: ${result.shaamRejectionOptions.join(", ")}.`
        : null,
      result.shaamHearingDeadline
        ? `Hearing deadline: ${result.shaamHearingDeadline}.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    meta: {
      shaam_status: result.shaamRejection ?? null,
      shaam_error_code: result.shaamErrorCode ?? null,
      options: result.shaamRejectionOptions ?? [],
      hearing_deadline: result.shaamHearingDeadline ?? null,
    },
  });
}
