# Agent / contributor guide — invoice app (Involoops)

## Next.js and framework versions

This repo uses **Next.js 16** with **React 19**. APIs and file layout can differ from older Next.js docs or from model training cutoffs.

- Before changing routing, RSC, `next/image`, middleware, or config, skim the in-repo guide: `node_modules/next/dist/docs/` (and deprecation notices in the same area).
- Prefer patterns already used in this codebase over generic Stack Overflow answers for older Next versions.

## Stack (short)

| Area | Choice |
|------|--------|
| App | Next.js App Router, TypeScript |
| DB | PostgreSQL via **Drizzle ORM** (`src/db/`, `drizzle.config.ts`, SQL under `drizzle/`) |
| Auth | **Auth.js v5** (`src/auth.ts`, `src/app/api/auth/`) |
| Files | S3-compatible (**MinIO** / AWS); clients in `src/lib/storage.ts`, `src/actions/upload-actions.ts` |
| Email | **Amazon SES** (`src/lib/email/ses.ts`, `SES_*` env vars) |
| Payments | **Stripe** (`src/lib/stripe.ts`, `src/app/api/webhooks/stripe/`) |
| UI | Tailwind v4, Radix/shadcn-style components under `src/components/ui/` |
| AI extraction | **Anthropic** (optional): `ANTHROPIC_API_KEY`; logic under `src/lib/extraction/` |

## Repository layout (where to look)

- `src/app/(app)/` — authenticated app shell (see **Main routes** below).
- `src/app/api/` — route handlers (webhooks, cron, upload, auth, public REST `v1/`).
- `src/features/expenses/` — inbound invoice intake, vendors, dashboards, duplicates (components + actions).
- `src/features/generator/` — outbound invoice creation, customers, templates, REST API helpers (components + actions).
- `src/actions/` — **shared / cross-domain** server actions only (auth, mfa, gdpr, locale, mode, subscription, etc.). Domain-specific actions live under `src/features/<domain>/actions/`.
- `src/components/` — **shared** UI only: `ui/`, `shell/`, `shared/`, `settings/`, `admin/`, `auth/`. Domain components live under `src/features/<domain>/components/`.
- `src/db/schema/` — Drizzle table definitions; keep migrations in sync with production. Schemas stay centralised so `relations.ts` can wire both domains.
- `src/lib/` — domain helpers (email, i18n, extraction, Stripe, Gmail, storage, etc.). `src/lib/outbound/` is generator-only by convention.
- `src/proxy.ts` — auth gate and public-route allowlist. Named `middleware.ts` until Next 16 deprecated that convention; the rename is the whole migration here, since the file was already a default export.
- `src/instrumentation.ts` — Node boot hook (e.g. Gmail `watch` renewal); must stay Edge-safe.
- `scripts/` — seeds, cron wrappers, Gmail OAuth helper; run with `npx tsx scripts/...`.

### Domain boundary (enforced by ESLint)

`src/features/expenses/**` and `src/features/generator/**` MUST NOT import each other. The rule lives in `eslint.config.mjs` (`no-restricted-imports`). The two sides meet only through:

- the shell `mode-switcher` / `creator-shell` (the user-facing toggle), and
- shared modules under `src/lib/**`, `src/db/**`, `src/components/{ui,shared,shell}/**`, `src/auth.ts`.

Anything outside both feature folders (e.g. `src/components/settings/**`) may import from either domain — those are consumers, not peers.

**Product / behavior spec (technology-agnostic):** `README.md`. **Env variable names and comments:** `.env.example` (source of truth).

## Main routes (`src/app/(app)/`)

| Area | Path segment |
|------|----------------|
| Dashboard & admin tabs | `dashboard/` |
| Invoice list / detail / upload | `invoices/`, `invoices/[id]/`, `invoices/upload/` |
| Pending approval | `pending/` |
| Review | `review/` |
| Duplicates | `duplicates/` |
| Income / profit | `income/`, `profit/` |
| Vendors | `vendors/`, `vendors/[id]/` |
| Outbound invoicing | `outbound/` |
| Settings | `settings/` |
| Tutorials | `tutorials/`, `tutorials/[slug]/` |
| User admin | `admin/users/` |

## Proxy (`src/proxy.ts`, formerly `middleware.ts`)

- **Default:** requests go through Auth.js middleware; unauthenticated users are redirected to `/login` with `callbackUrl`.
- **Skipped (public):** `/`, legal pages (`/privacy`, `/terms`, `/accessibility`), `/contact`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/api/auth/*`, `/api/webhooks/ses`, `/api/webhooks/gmail`, `/api/webhooks/stripe`, `/api/cron/*`.
- **Special case:** `/api/files/preview` — middleware skips `protectedAuth` (`NextResponse.next()` only) so the **route handler** enforces auth; avoids redirecting API/iframe clients to `/login` HTML.

## Auth (`src/auth.ts`)

- **Session strategy:** JWT (not DB sessions table).
- **Adapter:** Drizzle with explicit `users` / `accounts` table mapping (defaults would break OAuth).
- **`AUTH_URL` / `NEXTAUTH_URL`:** must match the browser URL; **HTTPS** here drives `useSecureCookies` and `__Secure-` cookie names—needed when the app is behind TLS termination and sees `http` internally (see comments in `auth.ts`).
- **Providers:** Google (if `AUTH_GOOGLE_*` set), credentials (email/password), plus internal “switch account” flow using `SESSION_COOKIE_NAME` / JWT decode (see file).

## Instrumentation (`src/instrumentation.ts`)

- Runs only in **Node** runtime (`NEXT_RUNTIME === "nodejs"`), not Edge.
- On startup, may renew Gmail **watch** subscription (`renewWatchIfExpiring` in `src/lib/gmail/renew.ts`). Safe no-op if `GMAIL_*` is unset or watch not registered.

## i18n (`src/lib/i18n/`)

- **Locales:** `en`, `he` (see `config.ts`).
- **Cookie:** `NEXT_LOCALE` (`LOCALE_COOKIE`).
- **Server API:** `getLocale()`, `getDictionary()`, `getLocaleTag()` in `server.ts`.
- **Adding a language:** steps are documented in `config.ts` (new locale, `localeConfig`, dictionary file, register in `dictionaries/index.ts`).

## Environment variables

Do not duplicate the full list here—**`.env.example`** is authoritative. Grouping for navigation:

| Group | Purpose |
|-------|---------|
| `AUTH_*`, `NEXTAUTH_URL` | Auth.js, OAuth, cookies |
| `DATABASE_URL` | Postgres |
| `S3_*`, `S3_PUBLIC_ENDPOINT` | Object storage (MinIO/AWS) |
| `SES_*` | Outbound email (SESv2) |
| `STRIPE_*` | Billing + webhook secret |
| `CRON_SECRET` | Bearer for `/api/cron/*` |
| `EMAIL_FUNNELS_ENABLED` | Master switch for funnel automation |
| `ANTHROPIC_API_KEY`, `USER_API_KEY_ENCRYPTION_SECRET` | LLM extraction + BYOK key encryption |
| `GMAIL_*` | **Separate** GCP/OAuth + Pub/Sub for inbox intake (not the same as `AUTH_GOOGLE_*`) |
| `DEFAULT_DISPLAY_CURRENCY`, `FX_*` | Dashboard FX display (`src/lib/fx.ts`) |
| `INVOICE_DEBUG_AUTH`, `INVOICE_DEBUG_DB` | Verbose auth / DB connection logging (`1` to enable) |

## Extraction pipeline

- PDF segmentation, text/vision/LLM extractors live under **`src/lib/extraction/`**.
- Optional **Anthropic** key for scans / LLM paths; users can **BYOK** in settings (encrypted with `USER_API_KEY_ENCRYPTION_SECRET` or derived from `AUTH_SECRET`).

## Conventions

- **Multi-tenancy:** scope all data by user; never leak cross-tenant rows.
- **Admin:** `users.isAdmin` (`src/lib/is-user-admin.ts`). Mirror existing admin actions for gated mutations.
- **Server actions:** small return payloads; `revalidatePath` / `router.refresh()` when UI must reflect writes.
- **Secrets:** never commit `.env`, `.env.local`, `.env.server`. Production deploy may rsync env separately (`production_deploy.sh`).

## Security-sensitive areas

- **Stripe webhook** — verify signature with `STRIPE_WEBHOOK_SECRET`.
- **Gmail webhook** — Pub/Sub OIDC audience (`GMAIL_PUBSUB_AUDIENCE`).
- **Cron** — require `Authorization: Bearer <CRON_SECRET>`.
- **Uploads** — preserve user scoping and size limits from existing presign/process routes.
- **File previews** — `/api/files/preview` refuses any object whose key is not under `{userId}/`. Sandbox copies of a production database trip this on every historical row; that is expected and documented in `docs/deployment-sandbox.md`. Never relax the check to quiet it — it cannot tell an account's own previous id from another account's.
- **CSP / headers** — global policy in `next.config.ts`; changing it can break GTM, MinIO, or PDF previews—test carefully.

## Email funnels

- DB-backed: `email_funnels`, steps, user state. Seed: `scripts/seed-email-funnels.ts`.
- **`EMAIL_FUNNELS_ENABLED=false`:** disables new entries and sends (`src/lib/email/funnel-enabled.ts`); unsubscribe/account cleanup still runs.
- Cron hits `POST /api/cron/funnel-emails` with `CRON_SECRET`.

## Cron and background work

- Host cron calls secured routes under `src/app/api/cron/`. Shell example: `scripts/cron-funnel-emails.sh`.

## Deploy (typical)

- **`production_deploy.sh`:** rsync project (excludes `node_modules`, `.next`, `.git`), sync `.env`, then `docker compose up -d --build app`.
- **Disk:** monitor Docker images and build cache on small VPS; prune when needed.

## Git and scope

- Do **not** commit or push unless the user explicitly asks.
- Keep changes scoped; avoid drive-by refactors and **unsolicited** new markdown files (this file and `CLAUDE.md` are the agent entry points).

## Quality bar

- Match local style: imports, errors, component patterns.
- After non-trivial edits: `npm run lint` and `npm run build` when possible.
- No `npm test` wired by default.

## Common commands

| Task | Command |
|------|---------|
| Dev | `npm run dev` |
| Build / start | `npm run build` / `npm run start` |
| Lint | `npm run lint` |
| Drizzle | `npx drizzle-kit generate` / `push` (per team workflow) |
| Scripts | `npx tsx scripts/<name>.ts` |

## Local Docker (`docker-compose.yml`)

- Project name **`invoices`**. Ports: app **3055** → 3000, MinIO API **9105**, pgAdmin **5051** (often localhost-only). See file header for required env vars.
