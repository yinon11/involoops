import { NextRequest, NextResponse } from "next/server";
import { completeAuthorization } from "@/lib/shaam/authorization";
import { getShaamConfig } from "@/lib/shaam/client";
import { ShaamApiError } from "@/lib/shaam/errors";
import { prefix, shaamError, shaamLog } from "@/lib/shaam/debug";

/**
 * Public origin of this deployment, used to build the post-callback
 * redirect to `/settings/ita-integration`.
 *
 * Behind a TLS-terminating reverse proxy the internal request that
 * Next.js sees is `http://localhost:3000/...`, so `req.nextUrl` would
 * bounce the browser to localhost even though it just came from
 * `https://sandbox.involoops.com`. Prefer, in order:
 *
 *   1. `SHAAM_REDIRECT_URI` — ITA literally just redirected the
 *      browser here, so its origin is the most authoritative public
 *      URL we have.
 *   2. `AUTH_URL` / `NEXTAUTH_URL` — project-wide public origin used
 *      by transactional emails, Stripe, etc.
 *   3. `req.nextUrl` — fine for local dev where the app is reached
 *      directly without TLS termination.
 */
function getPublicOrigin(req: NextRequest): URL {
  const candidates = [
    getShaamConfig().redirectUri,
    process.env.AUTH_URL ?? "",
    process.env.NEXTAUTH_URL ?? "",
  ];
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      return new URL(trimmed);
    } catch {
      /* try next candidate */
    }
  }
  return new URL(req.nextUrl.origin);
}

/**
 * ITA OAuth redirect target (Spec 07). Public route — must be added
 * to the middleware allowlist so the browser can land here without a
 * session. The authorization is tied to the pending-state row keyed
 * on the `state` param, which is itself generated from 32 random bytes
 * and unguessable without access to the server-side record.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Always log the inbound hit — gated `info` calls would hide this on
  // SHAAM_DEBUG=0, but the callback is rare enough that an unconditional
  // line is worth the noise: it's the single anchor that lets you confirm
  // ITA actually redirected back to *this* deployment.
  console.log("[shaam:oauth.callback] hit", {
    pathname: url.pathname,
    has_code: Boolean(code),
    has_state: Boolean(state),
    code_prefix: prefix(code, 6),
    state_prefix: prefix(state, 8),
    error: errorParam,
    error_description: errorDescription,
  });

  const dashboard = new URL("/settings/ita-integration", getPublicOrigin(req));

  if (errorParam) {
    shaamError("oauth.callback", "ITA returned an error in the redirect", {
      error: errorParam,
      error_description: errorDescription,
    });
    dashboard.searchParams.set("error", "access_denied");
    dashboard.searchParams.set(
      "detail",
      errorDescription ? `${errorParam}: ${errorDescription}` : errorParam,
    );
    return NextResponse.redirect(dashboard);
  }
  if (!state) {
    shaamError("oauth.callback", "missing state in callback", {});
    dashboard.searchParams.set("error", "invalid_state");
    return NextResponse.redirect(dashboard);
  }
  if (!code) {
    shaamError("oauth.callback", "missing code in callback", {
      state_prefix: prefix(state, 8),
    });
    dashboard.searchParams.set("error", "access_denied");
    return NextResponse.redirect(dashboard);
  }

  try {
    shaamLog("oauth.callback", "delegating to completeAuthorization", {
      state_prefix: prefix(state, 8),
      code_prefix: prefix(code, 6),
    });
    const result = await completeAuthorization({ state, code });
    console.log("[shaam:oauth.callback] success", {
      business_entity_id: result.businessEntityId,
      environment: result.environment,
    });
    dashboard.searchParams.set("authorized", "1");
    return NextResponse.redirect(dashboard);
  } catch (err) {
    if (err instanceof ShaamApiError) {
      shaamError(
        "oauth.callback",
        "completeAuthorization failed (ShaamApiError)",
        {
          http_status: err.httpStatus,
          ita_error_code: err.itaErrorCode,
          ita_message: err.itaMessage,
          request_id: err.requestId,
        },
      );
      dashboard.searchParams.set(
        "error",
        err.itaErrorCode === "invalid_state" ? "invalid_state" : "exchange_failed",
      );
      dashboard.searchParams.set(
        "detail",
        (err.itaMessage ?? err.message).slice(0, 200),
      );
    } else {
      shaamError(
        "oauth.callback",
        "completeAuthorization failed (non-API error)",
        {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
      );
      dashboard.searchParams.set("error", "exchange_failed");
      dashboard.searchParams.set(
        "detail",
        (err instanceof Error ? err.message : String(err)).slice(0, 200),
      );
    }
    return NextResponse.redirect(dashboard);
  }
}
