# Spec 03 — Rate Limits, Quotas, and Fairness

## Why this matters

The single Node process has finite throughput. With hundreds of concurrent integrators, one runaway script (or one popular customer) can starve the others. The plan: hard per-key limits, fair scheduling at the bottlenecks, plan-tier daily quotas, and clean 429 semantics.

## Limit tiers

| Limit | Default | Notes |
|---|---|---|
| **Burst** | 60 req / 1 s | Per API key. Token-bucket style. |
| **Sustained** | 1,000 req / 60 s | Per API key. Window aligned to wall clock. |
| **Concurrent** | 8 in-flight | Per API key. Excess returns 429 immediately rather than queueing. |
| **Daily quota** | Plan-tier (see below) | Per user, summed across all that user's keys. |
| **Issue-path** | 10 req / 1 s per `(business_entity, document_type, tax_year)` | Protects gapless allocator. |
| **Upload presign (API)** | 120 / 60 s per user (`/api/v1/uploads/route.ts`). | Shared `presign:<userId>` keyspace with the in-app upload flow (`/api/upload/file/route.ts`). |
| **Auth-failure brake** | 10 fails / 60 s per `publicId` → temporary 5 min freeze | Slows credential stuffing. |

### Plan tiers (initial)

| Plan | Daily request quota | Daily extraction quota | Webhook endpoints |
|---|---|---|---|
| Free | 1,000 | 50 docs | 1 |
| Starter | 10,000 | 500 docs | 3 |
| Pro | 100,000 | 5,000 docs | 10 |
| Business | 1,000,000 | 50,000 docs | 25 |

These wire into the existing `pricing_tiers` / `usage_tracking` tables. Quota checks happen **after** auth and **before** rate limiting, so a quota-exhausted key still returns 429 with a clear `code = "quota_exceeded"` and `Retry-After: <seconds-until-midnight-UTC+entity-tz>`.

## Headers (every response)

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 873
X-RateLimit-Reset: 1745151600          # epoch seconds
X-RateLimit-Resource: sustained        # which bucket this row is for
X-RateLimit-Burst-Remaining: 47
X-Quota-Daily-Limit: 10000
X-Quota-Daily-Remaining: 8421
X-Quota-Reset: 2026-04-21T00:00:00+03:00
Retry-After: 13                        # only on 429
```

## Implementation

The existing `enforceRateLimit(key, max, windowSec)` in `src/lib/rate-limit.ts:56` already has the right shape. We layer:

1. **Multi-bucket check.** A single helper `enforceApiKeyLimits(keyId, route)` calls `enforceRateLimit` three times: `apikey:burst:<id>`, `apikey:sustained:<id>`, optionally `apikey:concurrent:<id>` (using a separate small counter, decremented in a `try / finally`).
2. **Issue-path semaphore.** `enforceIssueLimit(businessEntityId, documentType, taxYear)` uses the same helper with a route-specific key.
3. **Daily quota.** Implemented against `usage_tracking` (existing). Single SQL `UPDATE ... RETURNING remaining` per request, with a row per `(user_id, day)`. No race because the DB is the truth.
4. **Multi-node migration path.** When we move off single-node, swap the `BUCKETS: Map` in `src/lib/rate-limit.ts` for an Upstash / Redis sliding-window implementation. The function signature does not change. The `usage_tracking` quota is already DB-backed, so it works immediately under multi-node. A short follow-up doc captures the cutover.

## 429 response shape

```json
{
  "type": "https://docs.involoops.com/api/errors/rate_limited",
  "title": "Too Many Requests",
  "status": 429,
  "code": "rate_limited",
  "detail": "burst limit (60/1s) exceeded",
  "request_id": "01HX5...",
  "retry_after_seconds": 1
}
```

`code` is always one of: `rate_limited`, `quota_exceeded`, `concurrency_exceeded`, `issue_path_busy`.

## Fairness notes

- We never globally serialize. Slow tenants only slow themselves.
- The issue-path semaphore is *per business entity, per type, per year* — so two tenants issuing tax invoices in parallel never collide.
- A burst from one key cannot exhaust another key's burst budget — bucket keys include the key id.
- Webhook deliveries (outgoing) get their own concurrency budget (Spec 05) and never compete with API request handling for the same workers.

## Operator controls

- Admin UI (gated by `isAdmin`): bump or pin a key's `daily_quota_override` and `sustained_override` fields. Useful for prearranged enterprise customers.
- Soft-block toggle on a key (e.g., abuse triage): returns 429 `code=key_paused` until cleared. Logged in audit.
- Alerts: 5xx rate > 0.5% over 5 min, or any key > 95% of its sustained limit for > 10 min, page the on-call.

## Client guidance (also in docs site)

- Honor `Retry-After`. Do not retry tighter.
- Use exponential backoff with jitter for 5xx and 429.
- Prefer **one large list call** over N small ones. The default `limit=50` is generous; raise to 200 for backfills.
- Set sane HTTP timeouts: `connect=5s`, `read=30s`. The issue endpoint can take longer when SHAAM is involved — see endpoint docs for per-route p95s.
