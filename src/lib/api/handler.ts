import { NextResponse, type NextRequest } from "next/server";
import type { ZodSchema } from "zod";
import { ApiError, apiErrors, problemResponse } from "./errors";
import { rateLimitHeaders } from "./rate-limit";
import { readOrCreateRequestId } from "./request-id";
import { requireApiKey, type ApiAuthContext } from "./authenticate";
import {
  fingerprintRequest,
  lookupIdempotency,
  readIdempotencyKey,
  storeIdempotency,
} from "./idempotency";
import type { Scope } from "./scopes";

/**
 * Shared route-handler shell for `/api/v1/*` endpoints.
 *
 * Responsibilities:
 *   - Generate / propagate `X-Request-Id`.
 *   - Parse the body as JSON (when applicable) and validate with a Zod schema.
 *   - Authenticate the API key + check scopes.
 *   - Apply Idempotency-Key replay logic on writes.
 *   - Translate any thrown `ApiError` into a Problem Details response.
 *   - Stamp rate-limit headers on every response.
 *
 * Domain logic stays in the existing server actions / thin DB calls.
 */

export interface HandlerOptions<TBody> {
  /** Scopes this endpoint requires (deny-by-default). */
  scopes: readonly Scope[];
  /**
   * If set, parse the JSON body and validate. For GETs with no body, omit
   * this entirely.
   */
  body?: ZodSchema<TBody>;
  /**
   * Idempotency mode for this endpoint:
   *   "required" — Idempotency-Key header MUST be present (state-creating POST)
   *   "supported" — header is honored when supplied (PATCH/PUT/DELETE)
   *   "off" — header is ignored (read-only GET)
   */
  idempotency?: "required" | "supported" | "off";
}

export interface HandlerInput<TBody> {
  ctx: ApiAuthContext;
  body: TBody;
  req: NextRequest;
  url: URL;
  requestId: string;
}

export interface HandlerResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export async function runApiRoute<TBody>(
  req: NextRequest,
  options: HandlerOptions<TBody>,
  fn: (input: HandlerInput<TBody>) => Promise<HandlerResult>,
): Promise<NextResponse> {
  const requestId = readOrCreateRequestId(req);
  const url = new URL(req.url);

  try {
    // Parse body up-front (so the idempotency fingerprint is stable).
    const body = await parseBody(req, options.body);

    const ctx = await requireApiKey(req, options.scopes);

    const idempotencyMode = options.idempotency ?? "off";
    const idempotencyKey =
      idempotencyMode === "off"
        ? null
        : readIdempotencyKey(req, idempotencyMode === "required");

    let fingerprint: string | null = null;
    if (idempotencyKey) {
      fingerprint = fingerprintRequest(req.method, url.pathname, body);
      const hit = await lookupIdempotency(
        ctx.apiKey.id,
        idempotencyKey,
        fingerprint,
      );
      if (hit) {
        return finalize(
          { status: hit.status, body: hit.body, headers: { "idempotent-replay": "true" } },
          ctx,
          requestId,
        );
      }
    }

    const result = await fn({ ctx, body: body as TBody, req, url, requestId });

    if (idempotencyKey && fingerprint) {
      await storeIdempotency(
        ctx.apiKey.id,
        idempotencyKey,
        fingerprint,
        result.status,
        result.body,
      );
    }

    return finalize(result, ctx, requestId);
  } catch (err) {
    if (err instanceof ApiError) {
      return problemResponse(err, requestId);
    }
    console.error("[api] unhandled", { requestId, err });
    return problemResponse(apiErrors.internal(), requestId);
  }
}

async function parseBody<T>(
  req: NextRequest,
  schema: ZodSchema<T> | undefined,
): Promise<unknown> {
  if (!schema) return undefined;
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  // Read the body up-front so we can distinguish "no payload" (curl -X POST
  // with no `-d`) from "JSON-shaped payload". Empty bodies are common on
  // verb endpoints like /issue and /mark-paid where the action takes no
  // arguments, so we don't want to force callers to ceremonially send an
  // empty `{}` with a Content-Type header just to satisfy the parser.
  const raw = await req.text();

  if (raw.length === 0) {
    const result = schema.safeParse({});
    if (!result.success) {
      throw apiErrors.validationFailed(
        result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    return result.data;
  }

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw apiErrors.unsupportedMediaType();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw apiErrors.malformedJson();
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw apiErrors.validationFailed(
      result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  }
  return result.data;
}

function finalize(
  result: HandlerResult,
  ctx: ApiAuthContext,
  requestId: string,
): NextResponse {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    ...rateLimitHeaders(ctx.rateLimit),
    ...(result.headers ?? {}),
  });
  return new NextResponse(JSON.stringify(result.body ?? null), {
    status: result.status,
    headers,
  });
}
