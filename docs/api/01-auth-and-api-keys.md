# Spec 01 — Authentication & API Keys

## Goal

Every public-API call is authenticated by a **bearer API key** that the user creates in the dashboard. Keys are scoped, revocable, rate-limited, and never recoverable in plaintext after creation.

## Key format

```
inv_live_<28 chars base62>.<32 chars base62>
inv_test_<28 chars base62>.<32 chars base62>
```

- **Prefix `inv_live_` / `inv_test_`** — environment marker. Test keys can only address sandbox business entities and never call SHAAM live.
- **Public id segment** (28 chars before the dot) — stored unhashed; used to look up the key row in `O(1)` and to display "last used" / "name" in the dashboard. Safe to log.
- **Secret segment** (32 chars after the dot) — never stored in plaintext. We store **HMAC-SHA-256(secret, pepper)** where `pepper` is a server-side env var (`API_KEY_PEPPER`). Constant-time compared on lookup.
- Total entropy ≥ 190 bits in the secret half.

The full token is shown **once**, at creation time, with a copy-to-clipboard control and a "I have stored this securely" confirmation. Subsequent views show only the prefix + last 4.

## Transport

- Header: `Authorization: Bearer inv_live_<id>.<secret>`.
- TLS required. Plain-HTTP requests are rejected with `426 Upgrade Required`.
- Keys in the query string are rejected (logs, browser history risk).

## DB schema (new)

```ts
// src/db/schema/api-keys.ts
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  businessEntityId: uuid("business_entity_id").references(() => businessEntities.id),
  name: text("name").notNull(),                   // user-chosen label
  publicId: text("public_id").notNull().unique(), // 28 chars, indexed
  secretHash: text("secret_hash").notNull(),      // hex of HMAC-SHA-256
  mode: text("mode", { enum: ["live", "test"] }).notNull(),
  scopes: text("scopes").array().notNull(),       // see scope catalog below
  ipAllowlist: text("ip_allowlist").array(),      // optional CIDR list
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByIp: text("created_by_ip"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastUsedIp: text("last_used_ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),  // optional
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
}, (t) => ({
  byUser: index("api_keys_user_idx").on(t.userId),
  byPublic: uniqueIndex("api_keys_public_id_idx").on(t.publicId),
}));
```

`lastUsedAt` is updated **at most once per minute per key** (debounced) to avoid write amplification on hot keys.

## Scope catalog

Deny-by-default. A request that touches a route lacking the right scope returns `403 forbidden` with `error.code = "missing_scope"` and the missing scope listed.

| Scope | Grants |
|---|---|
| `me:read` | `GET /me`, `GET /business-entity` |
| `outbound:read` | List/get outbound invoices, PDF, audit |
| `outbound:write` | Create/update drafts, delete drafts |
| `outbound:issue` | Issue, void, mark-paid, credit-note, send |
| `customers:read` / `customers:write` | Customers CRUD |
| `templates:read` / `templates:write` | Templates CRUD |
| `invoices:read` / `invoices:write` | Inbound expenses |
| `vendors:read` / `vendors:write` | Vendors CRUD + aliases + merge |
| `uploads:write` | Presign + process |
| `audit:read` / `archive:read` / `shaam:read` | Compliance reads |
| `webhooks:write` | Manage webhook endpoints |

We **do not** ship a `*` superscope. A "full access" key is just a key with every scope checked at creation; this keeps the audit trail honest.

## Lifecycle operations (UI + actions)

Implemented as new server actions under `src/actions/api-key-actions.ts`. UI lives at `src/app/(app)/settings/api-keys/`.

- `listApiKeys()` — never returns the secret hash.
- `createApiKey({ name, mode, scopes, expiresInDays?, ipAllowlist? })` — generates the secret with `crypto.randomBytes`, returns the **plaintext token once**.
- `revokeApiKey(id, reason?)` — sets `revokedAt`. Subsequent calls return `401 invalid_key`.
- `rotateApiKey(id)` — creates a new key inheriting name+scopes, sets a configurable grace period during which both keys work; the old key auto-revokes after the grace ends.
- `regenerateSecret(id)` — same as rotate but reuses the row (rare, mostly for compromised keys with active webhooks).

## Authentication middleware

A new `src/lib/api/authenticate.ts` exports `requireApiKey(req, requiredScopes: Scope[])` which:

1. Parses `Authorization: Bearer ...`. Reject `401` if missing/malformed.
2. Splits at the dot → `publicId`, `secret`.
3. Loads `api_keys` row by `publicId`. Reject `401 invalid_key` if not found / revoked / expired.
4. Computes `hmac = HMAC_SHA256(secret, API_KEY_PEPPER)` and **constant-time** compares to `secretHash`. Reject `401 invalid_key` on mismatch.
5. Enforces `ipAllowlist` if set (using the same `clientIpFromRequest` helper as the rate limiter).
6. Verifies every required scope is in `key.scopes`. Reject `403 missing_scope`.
7. Loads `userId` (and resolves `businessEntityId`) into a request-scoped context.
8. Schedules a debounced `lastUsedAt` / `lastUsedIp` update (fire-and-forget).
9. Returns `{ user, businessEntity, key, requestId }`.

The handler is the only place that touches plaintext secrets; downstream code receives the `key` row only.

Route handlers wrap their existing action call:

```ts
export async function POST(req: NextRequest) {
  const ctx = await requireApiKey(req, ["outbound:write"]);
  return jsonHandler(req, ctx, async (body) => {
    const draft = await createOutboundInvoice({ userId: ctx.user.id, ...body });
    return { status: 201, body: serializeOutboundInvoice(draft) };
  });
}
```

## What about BYOK Anthropic keys?

Per-user Anthropic keys (already in `users` table, AES-256-GCM) are unchanged. They are **not** API keys for our service — they are credentials we hold to call Anthropic on the user's behalf. The new `api_keys` table is unrelated.

## Test mode (`inv_test_*`)

- Test keys can only act on a business entity flagged `mode = "test"` (new column on `business_entities`, default `"live"`).
- SHAAM submissions are skipped (status auto-transitions to `NOT_APPLICABLE`).
- Outbound emails go to a sink address (`SES_TEST_SINK_EMAIL`) instead of the customer.
- Test data is namespaced and can be wiped with one click in settings.
- Webhook events fire normally so integrators can develop end-to-end.

## Audit

Every key creation, scope change, rotation, revocation, and **failed authentication burst** (≥10 fails in 60 s for the same `publicId`) writes an entry to `document-audit-log` (event types: `API_KEY_CREATED`, `API_KEY_REVOKED`, `API_KEY_ROTATED`, `API_KEY_AUTH_FAILED_BURST`). Successful API calls are logged in a lighter `api_request_log` table (see `09-security-checklist.md`).

## Compromise response

- "Revoke" is an instant DB write; the auth middleware reads `revokedAt` on every call (no key cache, or 5 s TTL cache that respects revocation tombstones).
- "Rotate" issues a new key and starts the grace timer.
- A user-visible "leaked-key alert" can be triggered from the dashboard when GitHub Secret Scanning notifies us (see `09-security-checklist.md` for the GitHub partner-program enrollment task).
