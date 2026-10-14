# InvoLoops MCP endpoint

> **Status:** Implemented.  
> **Route:** `GET|POST /api/mcp` (Streamable HTTP)  
> **Auth:** same bearer API keys as `/api/v1`

## What it is

A [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes InvoLoops capabilities as tools for AI clients (Cursor, Claude Desktop, etc.). Tools call the same domain operations and enforce the same scopes as the REST API — MCP is a thin agent-facing surface, not a second business layer.

## Connect a client

1. Create an API key in **Settings → API Keys** with the scopes you need.
2. Point the client at `https://<host>/api/mcp` with the key in `Authorization`.

### Cursor (`mcp.json`)

```json
{
  "mcpServers": {
    "involoops": {
      "url": "https://involoops.com/api/mcp",
      "headers": {
        "Authorization": "Bearer inv_live_…"
      }
    }
  }
}
```

For stdio-only clients, proxy with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "involoops": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://involoops.com/api/mcp",
        "--header",
        "Authorization: Bearer inv_live_…"
      ]
    }
  }
}
```

## Tools

### Business status / expenses (`invoices:read`)

Mint an API key with **`invoices:read`** for agent Q&A about spend and P&L.

| Tool | Notes |
|------|-------|
| `get_business_status` | **Start here** — income/expense/profit, burn, inbox, top vendors/clients, insights |
| `get_expense_summary` | Expense KPIs + full vendor breakdown + trend |
| `get_spend_by_vendor` | Vendor split with `share_pct` |
| `get_income_summary` | Income KPIs + client split |
| `get_profit_summary` | P&L + monthly breakdown |
| `get_spend_insights` | Heuristics: vendor spikes/drops, concentration, burn vs average, backlog |
| `list_inbound_invoices` | Drill-down by status/type/vendor/date; optional `sent_to_accountant` (`false` = not sent to accountant) |

Typical agent flow for “how is the business / where can we save?”:

1. `get_business_status`
2. `get_spend_insights` (or use insights already embedded in status)
3. `get_spend_by_vendor` / `list_inbound_invoices` for the flagged vendors

Insights are **heuristics**, not budgets — they compare a rolling window to the prior window of the same length and flag concentration / elevated burn.

### Outbound / CRM (generator)

| Tool | Scopes | Notes |
|------|--------|-------|
| `get_me` | `me:read` | User + key metadata |
| `get_business_entity` | `me:read` | Issuing entity |
| `list_customers` / `get_customer` | `customers:read` | Optional `q`, `limit` |
| `create_customer` / `update_customer` | `customers:write` | |
| `list_vendors` | `vendors:read` | Optional `q`, `is_income_source` |
| `list_invoice_templates` | `templates:read` | |
| `list_outbound_invoices` / `get_outbound_invoice` | `outbound:read` | |
| `create_outbound_invoice_draft` | `outbound:write` | Same body shape as REST, except line items use `unit_price` (stored and served on REST as `unitPrice`). A cached client may still send `items[].unitPrice`; the server maps it to `unit_price` and, when both are present, keeps `unit_price`. The alias is not in `tools/list`. |
| `update_outbound_invoice_draft` | `outbound:write` | Partial update. Drafts only. `items` replaces the whole line list and uses `unit_price`, same as credit-note lines. `items[].unitPrice` is accepted the same way as on create. |
| `delete_outbound_invoice_draft` | `outbound:write` | Soft-delete a draft only. Issued docs are rejected (credit note instead). |
| `issue_outbound_invoice` | `outbound:issue` | Signs + allocates number. Optional `confirm_zero_vat`: a 0% tax invoice that is not a reverse charge, from a business that normally charges VAT, is refused (422) until the caller sets this after the user confirms. |
| `issue_outbound_credit_note` | `outbound:issue` | Credit an issued invoice. `amount` equal to the remaining balance voids it. |
| `send_outbound_invoice` | `outbound:issue` | Email via SES |
| `mark_outbound_invoice_paid` / `void_outbound_invoice` | `outbound:issue` | |
| `get_outbound_invoice_pdf_url` | `outbound:read` | 5-minute download URL on the app host |

Typical issue flow for an agent:

1. `create_customer` (or `list_customers`)
2. `create_outbound_invoice_draft`
3. `update_outbound_invoice_draft` when a field needs fixing
4. `issue_outbound_invoice`
5. `send_outbound_invoice` / `get_outbound_invoice_pdf_url`

To reverse an issued invoice, call `issue_outbound_credit_note` with `amount` and `reason`. Drafts that should not be issued use `delete_outbound_invoice_draft`.

## Auth & security

- Bearer API keys (`inv_live_` / `inv_test_`) still work. Session cookies are ignored on `/api/mcp`.
- OAuth 2.0 authorization-code + PKCE (S256) is a second path for the Claude connector, enabled when `ANTHROPIC_MCP_CLIENT_ID` and `ANTHROPIC_MCP_CLIENT_SECRET` are set. The pre-registered client `involoops-claude` stays confidential (`client_secret_post` / `client_secret_basic`).
- Dynamic client registration is `POST /oauth/reg` with `Content-Type: application/json`. Discovery publishes `registration_endpoint`. Public clients use `token_endpoint_auth_method: none` and must send PKCE. Their refresh tokens rotate on every use. Allowed redirect URIs are `https://claude.ai/api/mcp/auth_callback` and `http://localhost[:port]/callback` or `http://127.0.0.1[:port]/callback`.
- The token endpoint stays `application/x-www-form-urlencoded`. Hosted Claude's redirect URI is `https://claude.ai/api/mcp/auth_callback`.
- Access tokens last one hour. Refresh tokens (scope `offline_access`) last 30 days. A request for `offline_access` is treated as `prompt=consent`, so the account holder sees the consent screen before a refresh token is issued.
- Rate limits and auth-failure brakes for API keys are unchanged (`authenticateApiKey`).
- Per-tool scope checks are deny-by-default for both paths.
- `/.well-known/oauth-protected-resource` advertises the MCP resource. When OAuth is configured it lists this origin as the authorization server. Discovery is `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`.

## Implementation map

| Path | Role |
|------|------|
| `src/app/api/mcp/route.ts` | Streamable HTTP handler (`@modelcontextprotocol/server`) |
| `src/lib/mcp/auth.ts` | API-key or OAuth access-token verify + per-tool scope helper |
| `src/lib/mcp/tools.ts` | Tool registration (outbound/CRM) |
| `src/lib/mcp/expense-tools.ts` | Business status / expense tools |
| `src/lib/expenses/analytics.ts` | UserId-scoped aggregations + insights |
| `src/lib/mcp/respond.ts` | JSON / error tool payloads |
| `src/app/.well-known/oauth-protected-resource/route.ts` | RFC 9728 metadata |
| `src/lib/oauth/` | Authorization server (oidc-provider), consent, opaque token store |
| `src/app/oauth/` | `/oauth/authorize`, `/oauth/token`, consent |

## Non-goals (for now)

- Client ID Metadata Documents
- True budgets / category rollups / anomaly ML (insights are period heuristics)
- Inbound invoice approve/reject mutations via MCP
- Webhook / upload tools (use REST for those)
