# Spec 07 — OpenAPI Spec & Hosted Docs Page

## Single source of truth

Every public endpoint is defined as a **Zod schema** for request and response. We generate the OpenAPI 3.1 spec from those schemas at build time. There is no hand-written YAML — drift between code and docs is the most common API bug, and we don't want it.

Tooling:

| Tool | Role |
|---|---|
| `zod` (already in repo) | Schema definitions colocated with handlers (`src/app/api/v1/<route>/schema.ts`). |
| `zod-to-openapi` (`@asteasolutions/zod-to-openapi`) | Converts schemas to an OpenAPI 3.1 document. |
| Build script (`scripts/generate-openapi.ts`) | Walks `src/app/api/v1/`, collects schemas, writes `public/openapi.json`. |
| `GET /api/v1/openapi.json` | Serves the generated spec. Cache-Control: `public, max-age=300`. |
| **Scalar** (`@scalar/api-reference-react`) | Renders the spec as the docs site. Lightweight, dark-mode, RTL-friendly. |

Why Scalar over Swagger UI / Redoc:
- Modern feel, fast load, no jQuery legacy.
- "Try it" panel works against `https://api.involoops.com` directly with the user's pasted API key.
- Right-aligned code panes with copy buttons — important for our Hebrew users (RTL handled cleanly).

## Where the docs live

- **`/developers`** — the marketing-friendly docs landing page (rendered server-side, indexed by Google). Contains the quickstart, conceptual guides, and links into Scalar for the reference.
- **`/developers/reference`** — the Scalar-rendered OpenAPI reference. Loads `/api/v1/openapi.json`.
- **`/developers/changelog`** — append-only markdown.
- **`/developers/errors/<code>`** — one page per error code. Linked from every `error.type` URL in API responses.
- **`/developers/recipes/<slug>`** — task-oriented walkthroughs (e.g. "Issue and email a tax invoice in 6 steps").

These pages live under the public `(marketing)` route group (no auth required). The "Try it" panel encourages signing in to copy a real key.

## Docs page layout

```
[ Top nav: Quickstart | Reference | Webhooks | Errors | Changelog | Status ]

LEFT
  - Getting started
    - Authentication
    - Idempotency
    - Pagination
    - Errors
    - Rate limits & quotas
    - Versioning
    - Webhooks
    - Test mode
  - Resources
    - Outbound invoices
    - Customers
    - Templates
    - Inbound invoices
    - Uploads
    - Vendors
    - Compliance (audit, archive, SHAAM)
  - Recipes
  - SDKs
    - cURL
    - TypeScript / Node
    - Python
    - PHP
  - Migration & versioning

CENTER
  - Conceptual content (markdown).
  - Inline OpenAPI snippets per endpoint.

RIGHT (sticky)
  - Code samples in the user's chosen language, generated from the OpenAPI op.
  - Copy-to-clipboard.
```

## Quickstart (the page itself)

A four-step quickstart, each step a runnable cURL block:

1. **Get a key** — link to settings; explain test vs live.
2. **Create a customer.**
3. **Create a draft invoice.**
4. **Issue + send the invoice.**

Each block uses `Idempotency-Key`, shows the response, and links to the full reference.

## Code samples

Generated from the OpenAPI spec via Scalar's built-in code-sample generator. Languages: cURL, Node `fetch`, TypeScript SDK (when published), Python `httpx`, PHP `Guzzle`. Each sample shows the auth header and a representative body.

## SDK plan (post-launch)

Out of scope for v1, but the OpenAPI-first approach means SDKs are mostly free:

- **TypeScript SDK** generated via `openapi-typescript` + a thin `InvoLoopsClient` wrapper that handles auth, retries, idempotency-key generation. Published as `@involoops/sdk` on npm.
- **Python SDK** via `openapi-python-client`.

Versioning of SDKs follows the API: `1.x` of the SDK targets API `v1`.

## Status page

`https://status.involoops.com` (third-party, e.g. Better Stack / Atlassian Statuspage). Components: API, Webhooks, Extraction, SHAAM, Email. Linked prominently from the docs.

## What good looks like

- Search works and is fast (Scalar's built-in or Algolia DocSearch).
- Every error code page exists and is linked.
- Every endpoint has a working `Try it` panel.
- "View source" on any docs page links to a markdown file in this repo. (Doc PRs become normal PRs.)
- Lighthouse perf > 90 on `/developers`.
