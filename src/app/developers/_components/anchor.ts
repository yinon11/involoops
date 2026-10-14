/**
 * Swagger UI deep-link anchor builder for the InvoLoops API.
 *
 * Swagger UI builds operation anchors as:
 *   #/<TagName>/<operationId>
 *
 * The tag is left readable (browser URL-encodes spaces) and the operationId
 * comes verbatim from the OpenAPI spec. Because we now set explicit
 * `operationId` on every operation in `src/lib/api/openapi.ts`, anchors are
 * deterministic and never depend on Swagger UI's path-mangling fallback.
 *
 * The `OPERATION_IDS` table here MUST stay in sync with that file. The
 * `assertOperationIdsInSync` helper (called from a test or build step) can
 * verify it programmatically against the generated spec.
 */
import { ROUTE_PATHS } from "./_routes";

export type ApiTag =
  | "Meta"
  | "Business entity"
  | "Customers"
  | "Vendors"
  | "Templates"
  | "Outbound invoices"
  | "Webhooks"
  | "Uploads";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * (HTTP method + path) → operationId. Path is the OpenAPI path key
 * (no `/v1` prefix — that's the server). Keep aligned with `openapi.ts`.
 */
const OPERATION_IDS: Record<string, string> = {
  "GET /health": "health.check",
  "GET /me": "me.get",
  "GET /business-entity": "businessEntity.get",

  "GET /customers": "customers.list",
  "POST /customers": "customers.create",
  "GET /customers/{id}": "customers.get",
  "PATCH /customers/{id}": "customers.update",
  "DELETE /customers/{id}": "customers.delete",

  "GET /vendors": "vendors.list",

  "GET /invoice-templates": "templates.list",
  "POST /invoice-templates": "templates.create",
  "GET /invoice-templates/{id}": "templates.get",
  "PATCH /invoice-templates/{id}": "templates.update",
  "DELETE /invoice-templates/{id}": "templates.delete",

  "GET /outbound-invoices": "outboundInvoices.list",
  "POST /outbound-invoices": "outboundInvoices.create",
  "GET /outbound-invoices/{id}": "outboundInvoices.get",
  "PATCH /outbound-invoices/{id}": "outboundInvoices.update",
  "DELETE /outbound-invoices/{id}": "outboundInvoices.delete",
  "POST /outbound-invoices/{id}/issue": "outboundInvoices.issue",
  "POST /outbound-invoices/{id}/send": "outboundInvoices.send",
  "POST /outbound-invoices/{id}/credit-note": "outboundInvoices.creditNote",
  "POST /outbound-invoices/{id}/mark-paid": "outboundInvoices.markPaid",
  "POST /outbound-invoices/{id}/void": "outboundInvoices.void",
  "GET /outbound-invoices/{id}/pdf": "outboundInvoices.pdf",

  "GET /webhook-endpoints": "webhookEndpoints.list",
  "POST /webhook-endpoints": "webhookEndpoints.create",
  "GET /webhook-endpoints/{id}": "webhookEndpoints.get",
  "PATCH /webhook-endpoints/{id}": "webhookEndpoints.update",
  "DELETE /webhook-endpoints/{id}": "webhookEndpoints.delete",
  "POST /webhook-endpoints/{id}/test": "webhookEndpoints.test",
  "POST /webhook-endpoints/{id}/rotate-secret":
    "webhookEndpoints.rotateSecret",

  "POST /uploads": "uploads.create",
  "GET /uploads/{id}": "uploads.get",
  "POST /uploads/{id}/process": "uploads.process",
};

function normalisePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function operationIdFor(method: HttpMethod, path: string): string {
  const key = `${method} ${normalisePath(path)}`;
  const id = OPERATION_IDS[key];
  if (!id) {
    // Fail loud in dev so a forgotten entry surfaces immediately.
    throw new Error(
      `[developers] No operationId mapped for ${key}. ` +
        `Add it to OPERATION_IDS in anchor.ts and openapi.ts.`,
    );
  }
  return id;
}

/** Anchor for jumping to a specific operation in Swagger UI. */
export function swaggerUiOperationAnchor(
  tag: ApiTag,
  method: HttpMethod,
  path: string,
): string {
  const operationId = operationIdFor(method, path);
  // Swagger UI hash format: `#/<tag>/<operationId>`.
  // Browsers URL-encode spaces in the tag automatically when navigating.
  return `#/${tag}/${operationId}`;
}

/** Full URL (path + hash) to deep-link from anywhere into Swagger UI. */
export function swaggerUiUrl(
  tag: ApiTag,
  method: HttpMethod,
  path: string,
): string {
  return `${ROUTE_PATHS.swagger}${swaggerUiOperationAnchor(tag, method, path)}`;
}

/** Anchor for jumping to a tag section in Swagger UI. */
export function swaggerUiTagAnchor(tag: ApiTag): string {
  return `#/${tag}`;
}
