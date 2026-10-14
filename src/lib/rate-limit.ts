/**
 * In-process token-bucket rate limiter.
 *
 * This is intentionally simple and process-local. It's enough to slow down
 * abuse from a single instance against auth, upload, and LLM endpoints. For
 * multi-node deployments, swap the Map for Redis / Upstash — keep the shape
 * of `enforceRateLimit(key, max, windowSeconds)`.
 *
 * All entries auto-expire; the map is bounded by periodic sweep.
 */

type Bucket = {
  /** Timestamps (ms) of hits still inside the window. */
  hits: number[];
};

const BUCKETS: Map<string, Bucket> = new Map();
const MAX_BUCKETS = 10_000;

let lastSweep = Date.now();

function sweep(nowMs: number) {
  if (nowMs - lastSweep < 60_000) return;
  lastSweep = nowMs;
  // Evict buckets whose newest hit is more than 10 minutes stale.
  const cutoff = nowMs - 10 * 60_000;
  for (const [k, b] of BUCKETS) {
    if (b.hits.length === 0 || b.hits[b.hits.length - 1] < cutoff) {
      BUCKETS.delete(k);
    }
  }
  // Hard cap to avoid unbounded growth under adversarial keys.
  if (BUCKETS.size > MAX_BUCKETS) {
    const keys = Array.from(BUCKETS.keys()).slice(
      0,
      BUCKETS.size - MAX_BUCKETS,
    );
    for (const k of keys) BUCKETS.delete(k);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the caller may retry. 0 when ok. */
  retryAfter: number;
  remaining: number;
}

/**
 * Fixed-window-ish rate limit check.
 *
 * @param key         Stable identifier (e.g. `presign:<userId>` or `login:<ip>`).
 * @param max         Max allowed hits inside the window.
 * @param windowSec   Window length in seconds.
 */
export async function enforceRateLimit(
  key: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  sweep(now);

  const windowMs = windowSec * 1_000;
  const cutoff = now - windowMs;

  let bucket = BUCKETS.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    BUCKETS.set(key, bucket);
  }

  // Drop hits outside the window.
  while (bucket.hits.length > 0 && bucket.hits[0] < cutoff) {
    bucket.hits.shift();
  }

  if (bucket.hits.length >= max) {
    const oldest = bucket.hits[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1_000));
    return { ok: false, retryAfter, remaining: 0 };
  }

  bucket.hits.push(now);
  return { ok: true, retryAfter: 0, remaining: max - bucket.hits.length };
}

/**
 * Best-effort client IP from a Next.js request. Falls back to "unknown".
 * X-Forwarded-For is spoofable but it's the standard behind reverse proxies.
 */
export function clientIpFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  return "unknown";
}
