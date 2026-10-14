import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Per-API-key rate limits. Burst + sustained. See
 * docs/api/03-rate-limiting-and-quotas.md.
 *
 * The underlying `enforceRateLimit(key, max, windowSec)` is process-local
 * today. When we move to multi-node, swap its store for Redis — this helper
 * does not change.
 */

export interface ApiKeyRateLimitDecision {
  ok: boolean;
  retryAfter: number;
  /** Which bucket triggered the rejection ("burst" or "sustained"), if any. */
  bucket: "burst" | "sustained" | null;
  burstRemaining: number;
  sustainedRemaining: number;
  sustainedLimit: number;
}

const DEFAULT_BURST_MAX = 60;
const DEFAULT_BURST_WINDOW_SEC = 1;
const DEFAULT_SUSTAINED_MAX = 1_000;
const DEFAULT_SUSTAINED_WINDOW_SEC = 60;

export async function enforceApiKeyLimits(
  apiKeyId: string,
): Promise<ApiKeyRateLimitDecision> {
  const burst = await enforceRateLimit(
    `apikey:burst:${apiKeyId}`,
    DEFAULT_BURST_MAX,
    DEFAULT_BURST_WINDOW_SEC,
  );
  if (!burst.ok) {
    return {
      ok: false,
      retryAfter: burst.retryAfter,
      bucket: "burst",
      burstRemaining: 0,
      sustainedRemaining: 0,
      sustainedLimit: DEFAULT_SUSTAINED_MAX,
    };
  }

  const sustained = await enforceRateLimit(
    `apikey:sustained:${apiKeyId}`,
    DEFAULT_SUSTAINED_MAX,
    DEFAULT_SUSTAINED_WINDOW_SEC,
  );
  if (!sustained.ok) {
    return {
      ok: false,
      retryAfter: sustained.retryAfter,
      bucket: "sustained",
      burstRemaining: burst.remaining,
      sustainedRemaining: 0,
      sustainedLimit: DEFAULT_SUSTAINED_MAX,
    };
  }

  return {
    ok: true,
    retryAfter: 0,
    bucket: null,
    burstRemaining: burst.remaining,
    sustainedRemaining: sustained.remaining,
    sustainedLimit: DEFAULT_SUSTAINED_MAX,
  };
}

/**
 * Auth-failure brake: 10 failed validations of the same publicId in 60s
 * triggers a temporary freeze. Slows credential-stuffing without
 * locking out a legitimate caller after a one-off typo.
 */
export async function enforceAuthFailureBrake(
  publicId: string,
): Promise<{ ok: boolean; retryAfter: number }> {
  const r = await enforceRateLimit(`apikey:auth_fail:${publicId}`, 10, 60);
  return { ok: r.ok, retryAfter: r.retryAfter };
}

export function rateLimitHeaders(
  decision: ApiKeyRateLimitDecision,
): Record<string, string> {
  return {
    "x-ratelimit-limit": String(decision.sustainedLimit),
    "x-ratelimit-remaining": String(decision.sustainedRemaining),
    "x-ratelimit-resource": "sustained",
    "x-ratelimit-burst-remaining": String(decision.burstRemaining),
  };
}
