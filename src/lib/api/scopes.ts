/**
 * Public-API scope catalog. Deny-by-default: a route lists the scopes it
 * needs and `requireApiKey` rejects anything missing. See
 * docs/api/01-auth-and-api-keys.md.
 *
 * No `*` superscope — a "full access" key is one with every scope checked
 * at creation, which keeps the audit trail honest.
 */
export const SCOPES = [
  "me:read",
  "outbound:read",
  "outbound:write",
  "outbound:issue",
  "customers:read",
  "customers:write",
  "templates:read",
  "templates:write",
  "invoices:read",
  "invoices:write",
  "vendors:read",
  "vendors:write",
  "uploads:write",
  "audit:read",
  "archive:read",
  "shaam:read",
  "webhooks:write",
] as const;

export type Scope = (typeof SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set(SCOPES);

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && SCOPE_SET.has(value);
}

export function parseScopes(values: readonly string[]): Scope[] {
  const out: Scope[] = [];
  for (const v of values) if (isScope(v)) out.push(v);
  return out;
}
