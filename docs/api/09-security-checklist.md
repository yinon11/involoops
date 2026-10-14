# Spec 09 — Security Checklist

Pre-launch gates. Each item is a binary "done / not done" — no half credit.

## Authentication & secrets

- [ ] API keys generated with `crypto.randomBytes(24)` for the secret half (≥190 bits entropy).
- [ ] Secret stored only as `HMAC-SHA256(secret, API_KEY_PEPPER)` (no plain hash; prevents rainbow-table attack on a leaked DB).
- [ ] `API_KEY_PEPPER` lives in env, never in source, never in logs.
- [ ] Secret comparison uses `crypto.timingSafeEqual`.
- [ ] Plaintext secret returned **only** on creation, never retrievable later.
- [ ] Test (`inv_test_*`) and live (`inv_live_*`) keys are distinct namespaces; test keys cannot mutate live data or call SHAAM live.
- [ ] `Authorization` header redacted in all logs (`api_request_log`, structured logger, Sentry).
- [ ] No API key accepted in query strings or request bodies.

## Transport

- [ ] HSTS enforced on `api.involoops.com` with `max-age=31536000; includeSubDomains; preload`.
- [ ] `Strict-Transport-Security`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` set on every API response.
- [ ] Plain HTTP returns `426 Upgrade Required`.
- [ ] TLS 1.2 minimum at the proxy.

## Authorization & multi-tenancy

- [ ] Every read query joins on `userId` (or `businessEntityId`) at the SQL level — verified by reviewing each new handler.
- [ ] `404` (not `403`) returned for resources that exist but belong to other tenants — never leak existence.
- [ ] Scope check happens **before** any DB read or write in every handler.
- [ ] Admin-only routes are not exposed under `/api/v1` at all.
- [ ] RBAC permissions (Spec 03 in `ita-compliance/`) enforced on the actions; the API does not bypass them.

## Input validation

- [ ] Every request body parsed by a Zod schema; no `any` paths.
- [ ] Currency codes validated against ISO-4217 list.
- [ ] Date fields validated against ISO-8601.
- [ ] Decimal fields parsed with a strict regex + range check.
- [ ] String length caps everywhere (descriptions, names, notes).
- [ ] Email fields validated with a strict parser; SES rejects garbage but we filter early.
- [ ] File `content_type` allowlist; file size ≤ 50 MB.

## Output handling

- [ ] No HTML in JSON responses (XSS surface for naive consumers).
- [ ] PDFs delivered via signed URL only; never base64-inlined.
- [ ] Error `detail` strings never echo secrets, file contents, or stack traces.
- [ ] Stack traces logged server-side with `request_id`; clients see only the code + safe detail.

## Rate limiting & abuse

- [ ] Burst, sustained, concurrency, and daily quotas all enforced (Spec 03).
- [ ] Auth-failure brake (10 fails / 60 s → 5 min freeze) live.
- [ ] Slow-loris protection at the proxy (request timeout 30 s, header timeout 10 s).
- [ ] Body size cap at the proxy (1 MB JSON; uploads are presigned and don't go through the proxy).
- [ ] Webhook outgoing fetch timeouts capped (10 s) and per-host concurrency capped (4).

## Idempotency

- [ ] All state-creating `POST` endpoints require `Idempotency-Key`.
- [ ] Replay returns the original response **only** on body-fingerprint match; mismatch → 409 (prevents accidental key reuse across distinct calls).
- [ ] Idempotency keys scoped to `(api_key_id, key)` so two keys can't collide.
- [ ] 24h TTL with a daily cleanup cron.

## Compliance carry-overs

- [ ] Issued documents truly immutable via the API: PATCH on a non-draft outbound returns `409`.
- [ ] Period-locked invoice dates rejected at creation/issue.
- [ ] Audit log entries written on every API mutation (existing actions handle this; tests assert).
- [ ] Gapless number allocator never exposed to "skip a number" via the API.
- [ ] SHAAM submissions surfaced read-only; no API path that bypasses submission rules.

## Webhooks (delivery side)

- [ ] HMAC-SHA256 signature with timestamp; 5 min replay window in docs.
- [ ] Signing secret stored hashed (same as API keys).
- [ ] Outgoing requests use a separate egress allowlist (no SSRF: webhook URLs must resolve to public IPs; reject RFC 1918 / link-local / `127.0.0.0/8` / `169.254.169.254` etc.).
- [ ] `Content-Length` cap on incoming response bodies (4 KiB stored, rest discarded).
- [ ] Auto-disable after 50 consecutive failures.

## SSRF & egress

- [ ] Webhook URL resolver validates the resolved IP at delivery time (not just at creation), to defeat DNS rebinding.
- [ ] No API endpoint takes a server-fetchable URL from the client other than webhook endpoints.

## Storage / S3

- [ ] Presigned PUT URLs scoped to a single object key + content type, ≤15 min TTL.
- [ ] Bucket has `BlockPublicAccess = true`; objects are read via short-lived presigned GETs only.
- [ ] No credentials exposed in URLs returned to clients (presigned URLs are signed query strings, which is the intended pattern; nothing else).

## Logging & PII

- [ ] `api_request_log` stores: timestamp, request_id, key_id, user_id, route, method, status, latency_ms, rate_limit_decision, idempotency_replay. **Not** body, **not** headers (other than a redacted user-agent).
- [ ] Customer PII in logs only when essential; default redaction.
- [ ] Logs retained 30 days hot, 12 months cold; deletion job verified.

## Operational

- [ ] Runbook for: leaked-key rotation, webhook backlog drain, SHAAM outage, rate-limit override.
- [ ] On-call alert rules for: 5xx rate, p95 latency, auth-failure burst, webhook DLQ depth.
- [ ] `gh` secret-scanning partner program enrollment for `inv_live_` and `inv_test_` prefixes (auto-revoke on detection).
- [ ] Quarterly key rotation reminder for any key inactive ≥ 90 days (email; user opt-out available).
- [ ] Penetration test scheduled before public announcement (focus: auth, multi-tenancy isolation, idempotency replay, webhook SSRF).

## Final pre-launch

- [ ] All checklist items above ticked.
- [ ] OpenAPI spec validates with `@redocly/cli lint` (zero errors).
- [ ] Load test (200 concurrent users, 60-min steady state) completed; report attached to launch ticket.
- [ ] Status page live, subscribed by `support@`.
- [ ] Public docs site reachable, search works, "Try it" succeeds with a real test key.
- [ ] Changelog post-1.0 entry written.
