@AGENTS.md

# Claude / Cursor — quick reminders

- **Full guide:** [`AGENTS.md`](./AGENTS.md) — line 1 loads it for this workspace.
- **Product / behavior spec (not stack):** [`README.md`](./README.md).
- **Next.js 16 / React 19:** skim `node_modules/next/dist/docs/` before using older Next patterns.
- **Auth:** `src/auth.ts` — JWT + Drizzle adapter; `AUTH_URL` HTTPS controls secure cookies (TLS termination behind proxies).
- **Proxy (was middleware):** `src/proxy.ts` — renamed per Next 16's deprecation of the `middleware` convention; still a default export, so only the filename changed. Public allowlist includes webhooks + `/api/cron/*`; `/api/files/preview` skips the session check (the handler authenticates); other app routes need a session.
- **Boot:** `src/instrumentation.ts` — Node-only Gmail watch renewal; don’t import Node-only code into Edge.
- **Locales:** `en` / `he`, cookie `NEXT_LOCALE`; see `src/lib/i18n/config.ts`.
- **Env:** `.env.example` is the checklist; Gmail intake uses **`GMAIL_*`**, not `AUTH_GOOGLE_*`.
- **Extraction:** `src/lib/extraction/` + optional `ANTHROPIC_API_KEY`; BYOK encryption `USER_API_KEY_ENCRYPTION_SECRET`.
- **Debug:** `INVOICE_DEBUG_AUTH=1`, `INVOICE_DEBUG_DB=1` when diagnosing auth/DB.
- **Secrets:** never commit `.env*` or paste tokens into docs.
- **Git:** commit/push only when the user asks.
