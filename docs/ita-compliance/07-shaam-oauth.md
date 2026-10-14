# Spec 07 — SHAAM OAuth Client

Archive copy. Canonical source: conversation transcript.

## What landed

- **Schema** — `shaam_authorizations` (encrypted refresh/access
  tokens, per business entity × env), `shaam_token_events` (append-only
  diagnostic log), `shaam_authorization_pending` (short-lived
  state/code-verifier rows for the OAuth dance).
- **Crypto** — AES-256-GCM refresh/access token encryption with
  tamper-detection. Key derived from `SHAAM_TOKEN_ENCRYPTION_SECRET`
  or, fallback, `AUTH_SECRET` with a `"shaam-tokens:"` salt prefix.
- **Client** — `fetch`-based OAuth client against openapi.taxes.gov.il.
  Every endpoint path + base URL + scope is env-overridable so the operator
  can adjust when the ITA developer portal confirms the actual routes.
  15s timeout, 3x retries with exponential back-off on 5xx + network
  errors, no retry on 4xx.
- **Authorization service** — `initiateAuthorization` (PKCE verifier +
  random state), `completeAuthorization` (exchanges code, encrypts and
  stores tokens, deletes the pending row), `getActiveAccessToken`
  (serialised-by-`FOR UPDATE` cached access token returner with
  proactive refresh + refresh-token rotation handling),
  `revokeAuthorization` (best-effort server revoke + DB state flip).
- **OAuth callback route** — `GET /api/shaam/oauth/callback`, added to
  the middleware public allowlist. Redirects to
  `/admin/shaam?authorized=1` on success, `?error=...&detail=...` on
  failure.
- **Admin UI** — `/admin/shaam` with env selector, per-entity status
  table, Authorize / Revoke / Test connection actions, token-events
  viewer, "expiring soon" banner (14-day lookahead), success/error
  callback banners.
- **Cron routes** — `POST /api/cron/shaam-refresh-tokens` (proactive
  refresh; 6-hourly) and `POST /api/cron/shaam-expire-scan` (reconcile
  expired authorizations; daily). Both `CRON_SECRET`-gated.
- **Typed errors** — `ShaamAuthorizationError`
  (`never_authorized | pending | expired | revoked | error`) and
  `ShaamApiError`. Imported by Spec 08 for invoice submission error
  handling.
- **i18n** — `admin.nav.shaam`, `shaam.env.*`, `shaam.status.*`,
  `shaam.action.*`, `shaam.refresh.*`, `shaam.callback.*`,
  `shaam.events.*`, `shaam.banner.expiringSoon` in both en + he.
- **Verification** — `scripts/verify-shaam-oauth.ts` (next, below).

## Configuration checklist

Before Spec 07 is usable end-to-end, register an InvoLoops app at
`openapi.taxes.gov.il`, subscribe to the "Invoice Approval 1.0.0"
product, set `SHAAM_CLIENT_ID` / `SHAAM_CLIENT_SECRET` /
`SHAAM_REDIRECT_URI` / `SHAAM_TOKEN_ENCRYPTION_SECRET` in `.env`.
See `.env.example` for the full list.

### `SHAAM_PROXY_URL` (when you need it)

- **Set** when the Next.js server has a non-Israeli egress IP and ITA
  rejects direct TLS (common for cloud regions outside IL).
- **Unset** when the server already egresses from Israel (e.g. sandbox VM
  in IL, or another IL-terminated VPN). In that case the proxy adds
  only latency and can **break** OAuth if the proxy's own egress is not
  in a range ITA accepts.
- OAuth authorize is **browser → ITA**; token exchange is **server →
  ITA** (optionally via proxy). A working SMS authorize step does not
  validate the proxy path — use `npx tsx scripts/verify-shaam-proxy.ts`
  or `curl -v -x "$SHAAM_PROXY_URL" https://openapi.taxes.gov.il/…`
  to test the tunnel.

Sandbox / tsandbox long-lived token flows often use
`SHAAM_BASE_URL_UAT=https://openapi.taxes.gov.il` with paths such as
`/shaam/tsandbox/longtimetoken/oauth2/authorize` — those come from the
ITA developer portal for your app, not from this repo's commented
defaults (`openapi.uat.taxes.gov.il` + `/oauth/authorize`).

## Verification scripts after Spec 07

- `verify-numbering.ts` — 6/6 (unchanged).
- `verify-audit.ts` — 5/5 (unchanged).
- `verify-rbac.ts` — 7/7 (unchanged).
- `verify-signing.ts` — 7/7 (unchanged).
- `verify-archive.ts` — 5/5 when S3 reachable (unchanged).
- `verify-credit-notes.ts` — 9/9 (unchanged).
- `verify-shaam-oauth.ts` — new; 10 scenarios (crypto roundtrip,
  crypto tamper, full authorization flow with stubbed fetch, access
  token reuse, refresh-on-near-expiry, rotation, 401 → EXPIRED,
  concurrent refresh race, cron scan summary, revoke flow).
