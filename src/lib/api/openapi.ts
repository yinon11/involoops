/**
 * OpenAPI 3.1 spec for the InvoLoops public REST API.
 *
 * Request bodies derive from the Zod schemas in `src/lib/api/schemas.ts`
 * via `z.toJSONSchema()` — one source of truth for validation + docs.
 * Response bodies are described inline as JSON Schema; they shadow the
 * serializers in `src/lib/api/serializers/`. When a serializer changes,
 * the response schema here must change too.
 *
 * The spec is built once per process and memoised; `GET /api/v1/openapi.json`
 * serves it with a short cache header.
 */

import { z } from "zod";
import {
  customerCreateSchema,
  customerUpdateSchema,
  outboundInvoiceCreateSchema,
  outboundInvoiceDraftPatchSchema,
  outboundInvoiceIssueSchema,
  outboundInvoiceMarkPaidSchema,
  outboundInvoiceVoidSchema,
  outboundInvoiceSendSchema,
  outboundInvoiceShaamDecisionSchema,
  reverseChargeToggleSchema,
  reverseChargeConsentRequestSchema,
  outboundInvoiceCreditNoteSchema,
  templateUpsertSchema,
  webhookEndpointCreateSchema,
  webhookEndpointPatchSchema,
  webhookRotateSecretSchema,
  webhookTestDeliverySchema,
  uploadCreateSchema,
  uploadProcessSchema,
} from "./schemas";
import { SCOPES } from "./scopes";
import { EVENT_TYPES } from "@/lib/webhooks/events";

type JsonSchema = Record<string, unknown>;

function fromZod(schema: unknown): JsonSchema {
  // `z.toJSONSchema` is in zod v4.
  return z.toJSONSchema(schema as never) as JsonSchema;
}

/**
 * Static fallback for SDK generators / external tooling that fetches
 * the spec without an HTTP request context (e.g. building a snapshot
 * to commit). The real list is built per-request by `buildServers()`
 * from the live `Host` header so Swagger UI's "Try it out" panel
 * always targets the deployment serving the docs.
 *
 * Only real, deployed hostnames belong here. Add an entry when (and
 * only when) DNS + reverse proxy actually answer for it.
 */
const KNOWN_SERVERS = [
  {
    url: "https://involoops.com/api/v1",
    description: "Production",
  },
  {
    url: "https://sandbox.involoops.com/api/v1",
    description: "Sandbox",
  },
];

/**
 * Build the per-request `servers` list. The currently-serving origin
 * (e.g. `https://sandbox.involoops.com` or `http://localhost:3000`) is
 * pre-pended so Swagger UI's "Try it out" panel hits the SAME deployment
 * the docs page is served from — otherwise sandbox users would
 * accidentally fire requests at production. Other known environments
 * stay in the list so SDK generators that consume the static spec see
 * every reachable host.
 */
function buildServers(currentOrigin: string | null): Array<{
  url: string;
  description: string;
}> {
  if (!currentOrigin) return KNOWN_SERVERS;
  const currentApi = `${currentOrigin}/api/v1`;
  // De-dupe in case we're already running on one of the known hosts.
  const filtered = KNOWN_SERVERS.filter((s) => s.url !== currentApi);
  return [
    { url: currentApi, description: "This deployment" },
    ...filtered,
  ];
}

// ---- Reusable response shapes (hand-written JSON Schema) ------------------

const isoDateTime: JsonSchema = { type: "string", format: "date-time" };
const isoDate: JsonSchema = { type: "string", format: "date" };
const decimalString: JsonSchema = {
  type: "string",
  pattern: "^-?\\d{1,12}(\\.\\d{1,2})?$",
  description:
    "String-encoded decimal, max 2 fraction digits — avoids float drift.",
};
const currencyCode: JsonSchema = {
  type: "string",
  pattern: "^[A-Z]{3}$",
  description: "ISO-4217 currency code (uppercase).",
};
const uuid: JsonSchema = { type: "string", format: "uuid" };
const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: "null" }] });

const customerResponse: JsonSchema = {
  type: "object",
  required: ["object", "id", "name", "created_at", "updated_at"],
  properties: {
    object: { type: "string", const: "customer" },
    id: uuid,
    name: { type: "string" },
    email: nullable({
      type: "string",
      format: "email",
      example: "customer@example.com",
    }),
    phone: nullable({ type: "string" }),
    address: nullable({ type: "string" }),
    tax_id: nullable({ type: "string" }),
    notes: nullable({ type: "string" }),
    created_at: nullable(isoDateTime),
    updated_at: nullable(isoDateTime),
  },
};

const lineItem: JsonSchema = {
  type: "object",
  required: ["description", "quantity", "unitPrice", "total"],
  properties: {
    description: { type: "string" },
    quantity: { type: "number" },
    unitPrice: { type: "number" },
    total: { type: "number" },
  },
};

const outboundInvoiceResponse: JsonSchema = {
  type: "object",
  required: [
    "object",
    "id",
    "document_type",
    "tax_year",
    "invoice_date",
    "items",
    "subtotal",
    "total",
    "status",
    "version",
  ],
  properties: {
    object: { type: "string", const: "outbound_invoice" },
    id: uuid,
    /**
     * Null while the document is in `draft` status. The fiscal number
     * is allocated atomically when the draft is issued, so abandoned
     * drafts don't punch holes in the issued sequence, which is the
     * established convention among Israeli invoicing systems. Use
     * `draft_reference` for a UI-friendly placeholder while it's null.
     */
    formatted_number: nullable({ type: "string", example: "2026-TI-000001" }),
    draft_reference: nullable({ type: "string", example: "DRAFT-3f8a91c2" }),
    document_type: {
      type: "string",
      enum: [
        "TAX_INVOICE",
        "TAX_INVOICE_RECEIPT",
        "RECEIPT",
        "CREDIT_INVOICE",
        "PROFORMA",
        "DELIVERY_NOTE",
      ],
    },
    tax_year: { type: "integer" },
    sequence_number: nullable({ type: "integer" }),
    template_id: nullable(uuid),
    customer_id: nullable(uuid),
    invoice_date: isoDate,
    due_date: nullable(isoDate),
    items: { type: "array", items: lineItem },
    payments: { type: "array", items: { type: "object" } },
    subtotal: decimalString,
    vat_rate: nullable(decimalString),
    vat_amount: nullable(decimalString),
    total: decimalString,
    currency: nullable(currencyCode),
    language: nullable({ type: "string" }),
    notes: nullable({ type: "string" }),
    status: {
      type: "string",
      enum: ["draft", "issued", "sent", "paid", "voided"],
    },
    pdf_url: nullable({ type: "string" }),
    shaam_status: {
      type: "string",
      enum: [
        "NOT_APPLICABLE",
        "NOT_REQUIRED",
        "PENDING",
        "APPROVED",
        "REJECTED",
        "HELD",
        "OUTAGE_ISSUED",
      ],
    },
    allocation_number: nullable({ type: "string" }),
    sandbox: { type: "boolean" },
    shaam_submitted_at: nullable(isoDateTime),
    shaam_response_at: nullable(isoDateTime),
    shaam_retry_count: { type: "integer" },
    shaam_last_error_code: nullable({ type: "string" }),
    shaam_last_error_message: nullable({ type: "string" }),
    references_document_id: nullable(uuid),
    net_of_credits_amount: nullable(decimalString),
    version: { type: "integer" },
    created_at: nullable(isoDateTime),
    updated_at: nullable(isoDateTime),
  },
};

const outboundInvoiceListRow: JsonSchema = {
  type: "object",
  required: ["object", "id", "document_type", "status"],
  properties: {
    object: { type: "string", const: "outbound_invoice" },
    id: uuid,
    formatted_number: nullable({ type: "string" }),
    draft_reference: nullable({ type: "string", example: "DRAFT-3f8a91c2" }),
    document_type: outboundInvoiceResponse.properties &&
      ((outboundInvoiceResponse.properties as JsonSchema).document_type as JsonSchema),
    tax_year: { type: "integer" },
    sequence_number: nullable({ type: "integer" }),
    invoice_date: isoDate,
    due_date: nullable(isoDate),
    total: decimalString,
    currency: nullable(currencyCode),
    status: outboundInvoiceResponse.properties &&
      ((outboundInvoiceResponse.properties as JsonSchema).status as JsonSchema),
    shaam_status: outboundInvoiceResponse.properties &&
      ((outboundInvoiceResponse.properties as JsonSchema).shaam_status as JsonSchema),
    allocation_number: nullable({ type: "string" }),
    customer_name: nullable({ type: "string" }),
    created_at: nullable(isoDateTime),
  },
};

const templateResponse: JsonSchema = {
  type: "object",
  required: ["object", "id", "name", "design_id"],
  properties: {
    object: { type: "string", const: "invoice_template" },
    id: uuid,
    name: { type: "string" },
    design_id: { type: "string" },
    accent_color: nullable({ type: "string" }),
    logo_url: nullable({ type: "string" }),
    business_phone: nullable({ type: "string" }),
    business_email: nullable({
      type: "string",
      format: "email",
      example: "billing@example.com",
    }),
    business_website: nullable({ type: "string" }),
    show_vat_breakdown: nullable({ type: "boolean" }),
    default_currency: nullable(currencyCode),
    default_language: nullable({ type: "string" }),
    is_default: nullable({ type: "boolean" }),
    created_at: nullable(isoDateTime),
    updated_at: nullable(isoDateTime),
  },
};

const vendorResponse: JsonSchema = {
  type: "object",
  required: ["object", "id", "name"],
  properties: {
    object: { type: "string", const: "vendor" },
    id: uuid,
    name: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    default_category: nullable({ type: "string" }),
    is_income_source: { type: "boolean" },
    auto_approve: { type: "boolean" },
    website_url: nullable({ type: "string" }),
    website_url_2: nullable({ type: "string" }),
    tracking_excluded: { type: "boolean" },
    created_at: nullable(isoDateTime),
  },
};

const businessEntityResponse: JsonSchema = {
  type: "object",
  required: ["object", "id", "legal_name", "entity_type"],
  properties: {
    object: { type: "string", const: "business_entity" },
    id: uuid,
    legal_name: { type: "string" },
    legal_name_en: nullable({ type: "string" }),
    osek_murshe: nullable({ type: "string" }),
    entity_type: {
      type: "string",
      enum: ["OSEK_MURSHE", "OSEK_PATUR", "CHEVRA_BAAM", "AMUTA", "SHUTAFUT"],
    },
    address: { type: ["object", "null"] },
    phone: nullable({ type: "string" }),
    email: nullable({
      type: "string",
      format: "email",
      example: "billing@example.com",
    }),
    tax_year_starts_month: { type: "integer", minimum: 1, maximum: 12 },
    default_vat_inclusive: { type: "boolean" },
    created_at: isoDateTime,
    updated_at: isoDateTime,
  },
};

function pageEnvelope(itemSchemaRef: string): JsonSchema {
  return {
    type: "object",
    required: ["data", "page"],
    properties: {
      data: { type: "array", items: { $ref: itemSchemaRef } },
      page: {
        type: "object",
        required: ["next_cursor", "has_more", "limit"],
        properties: {
          next_cursor: nullable({ type: "string" }),
          has_more: { type: "boolean" },
          limit: { type: "integer" },
        },
      },
    },
  };
}

const problemDetails: JsonSchema = {
  type: "object",
  required: ["type", "title", "status", "code", "request_id"],
  properties: {
    type: { type: "string", format: "uri" },
    title: { type: "string" },
    status: { type: "integer" },
    code: { type: "string" },
    detail: { type: "string" },
    request_id: { type: "string" },
    errors: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "message"],
        properties: {
          path: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  },
};

// ---- Reusable parameters --------------------------------------------------

const idParam = {
  in: "path",
  name: "id",
  required: true,
  schema: uuid,
  description: "UUID of the resource. Always opaque to clients — never parse.",
};

const cursorParam = {
  in: "query",
  name: "cursor",
  required: false,
  schema: { type: "string" },
  description:
    "Opaque cursor returned in the previous response's `page.next_cursor`. " +
    "Omit on the first page; pass it back verbatim to fetch the next page.",
};

const limitParam = {
  in: "query",
  name: "limit",
  required: false,
  schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  description:
    "Page size. Defaults to 50, capped at 200. Larger pages cost more " +
    "rate-limit budget per call but reduce round-trips.",
};

const searchQueryParam = {
  in: "query",
  name: "q",
  required: false,
  schema: { type: "string" },
  description:
    "Case-insensitive substring search. Matched against name, email, and " +
    "tax_id where applicable.",
};

const idempotencyKeyHeader = {
  in: "header",
  name: "Idempotency-Key",
  required: true,
  schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,255}$" },
  description:
    "Client-generated idempotency key (ULID/UUID recommended). 24h replay window.",
};

const optionalIdempotencyKeyHeader = {
  ...idempotencyKeyHeader,
  required: false,
};

// ---- Common responses -----------------------------------------------------

const problemResponse = (description: string) => ({
  description,
  content: {
    "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
  },
});

const standardErrors = {
  "401": problemResponse("Missing or invalid API key."),
  "403": problemResponse("Authenticated but missing the required scope."),
  "429": problemResponse("Rate limit or quota exceeded."),
  "500": problemResponse("Internal server error."),
};

const writeErrors = {
  ...standardErrors,
  "400": problemResponse("Malformed request."),
  "409": problemResponse("Conflict (idempotency mismatch, illegal transition, etc.)."),
  "415": problemResponse("Content-Type must be application/json."),
  "422": problemResponse("Validation failed."),
};

// ---- Operation builders ---------------------------------------------------

interface OpDef {
  /**
   * Stable, deterministic identifier. Required so docs renderers
   * (Swagger UI, Scalar, Redoc) all build identical deep-link anchors
   * (`#/<tag>/<operationId>` in Swagger UI). Convention: `<resource>.<action>`,
   * camelCase resource (`outboundInvoices.issue`, `customers.update`).
   */
  operationId: string;
  summary: string;
  description?: string;
  scope: string;
  tags: string[];
  parameters?: unknown[];
  requestBody?: { schema: unknown; required?: boolean };
  responses: Record<string, unknown>;
}

function op(d: OpDef) {
  const out: Record<string, unknown> = {
    operationId: d.operationId,
    summary: d.summary,
    description: d.description,
    tags: d.tags,
    "x-required-scope": d.scope,
    security: [{ bearerAuth: [d.scope] }],
    responses: d.responses,
  };
  if (d.parameters) out.parameters = d.parameters;
  if (d.requestBody) {
    out.requestBody = {
      required: d.requestBody.required ?? true,
      content: {
        "application/json": { schema: d.requestBody.schema },
      },
    };
  }
  return out;
}

// ---- Spec assembly --------------------------------------------------------

let cached: Record<string, unknown> | null = null;

/**
 * Returns the OpenAPI 3.1 spec. Pass the current request origin so the
 * `servers` block advertises the actual host serving the docs as the
 * default — without it, Swagger UI's "Try it out" panel would default
 * to production even when the docs are loaded from sandbox/localhost.
 *
 * The base spec is memoised; only the `servers` array is rebuilt per
 * call (cheap), so cross-origin requests still benefit from the cache.
 */
export function getOpenApiSpec(
  currentOrigin: string | null = null,
): Record<string, unknown> {
  const base = cached ?? buildBaseSpec();
  if (!cached) cached = base;
  return { ...base, servers: buildServers(currentOrigin) };
}

function buildBaseSpec(): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    openapi: "3.1.0",
    info: {
      title: "InvoLoops API",
      version: "1.0.0",
      description:
        "REST API for the InvoLoops invoice generator and expense manager. " +
        "Authenticate every call with a bearer API key issued from " +
        "Settings → API Keys. See https://docs.involoops.com for the " +
        "narrative docs.",
      contact: { name: "InvoLoops", url: "https://involoops.com" },
    },
    // Placeholder; the real list is built per-request by `getOpenApiSpec`
    // so the host serving the docs is advertised first.
    servers: KNOWN_SERVERS,
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "Meta" },
      { name: "Auth" },
      { name: "Expenses" },
      { name: "Business entity" },
      { name: "Customers" },
      { name: "Vendors" },
      { name: "Templates" },
      { name: "Outbound invoices" },
      { name: "Webhooks" },
      { name: "Uploads" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat:
            "InvoLoops API key (inv_live_… / inv_test_…) or a device access token",
        },
      },
      schemas: {
        Problem: problemDetails,
        Customer: customerResponse,
        CustomerCreate: fromZod(customerCreateSchema),
        CustomerUpdate: fromZod(customerUpdateSchema),
        OutboundInvoice: outboundInvoiceResponse,
        OutboundInvoiceListRow: outboundInvoiceListRow,
        OutboundInvoiceCreate: fromZod(outboundInvoiceCreateSchema),
        OutboundInvoiceDraftPatch: fromZod(outboundInvoiceDraftPatchSchema),
        OutboundInvoiceIssue: fromZod(outboundInvoiceIssueSchema),
        OutboundInvoiceMarkPaid: fromZod(outboundInvoiceMarkPaidSchema),
        OutboundInvoiceVoid: fromZod(outboundInvoiceVoidSchema),
        OutboundInvoiceSend: fromZod(outboundInvoiceSendSchema),
        OutboundInvoiceShaamDecision: fromZod(outboundInvoiceShaamDecisionSchema),
        ReverseChargeToggle: fromZod(reverseChargeToggleSchema),
        ReverseChargeConsentRequest: fromZod(reverseChargeConsentRequestSchema),
        OutboundInvoiceCreditNote: fromZod(outboundInvoiceCreditNoteSchema),
        OutboundInvoiceSendResult: {
          type: "object",
          required: ["object", "status", "recipient", "sent_at"],
          properties: {
            object: {
              type: "string",
              const: "outbound_invoice_send_result",
            },
            message_id: nullable({ type: "string" }),
            status: {
              type: "string",
              enum: ["draft", "issued", "sent", "paid", "voided"],
            },
            recipient: {
              type: "string",
              format: "email",
              example: "customer@example.com",
            },
            sent_at: isoDateTime,
          },
        },
        Template: templateResponse,
        TemplateUpsert: fromZod(templateUpsertSchema),
        Vendor: vendorResponse,
        BusinessEntity: businessEntityResponse,
        AvailableScope: { type: "string", enum: [...SCOPES] },
        WebhookEventType: { type: "string", enum: [...EVENT_TYPES] },
        WebhookEndpoint: {
          type: "object",
          required: ["id", "url", "events", "active", "secret_hint", "created_at"],
          properties: {
            object: { type: "string", const: "webhook_endpoint" },
            id: uuid,
            url: { type: "string", format: "uri" },
            description: nullable({ type: "string" }),
            events: {
              type: "array",
              items: { $ref: "#/components/schemas/WebhookEventType" },
            },
            active: { type: "boolean" },
            secret_hint: { type: "string" },
            created_at: isoDateTime,
            last_delivery_at: nullable(isoDateTime),
            last_success_at: nullable(isoDateTime),
            consecutive_failures: { type: "integer" },
            disabled_at: nullable(isoDateTime),
            disabled_reason: nullable({ type: "string" }),
          },
        },
        WebhookEndpointWithSecret: {
          allOf: [
            { $ref: "#/components/schemas/WebhookEndpoint" },
            {
              type: "object",
              required: ["secret"],
              properties: {
                secret: {
                  type: "string",
                  description:
                    "Plaintext signing secret. Shown ONCE — store it in a secret manager immediately.",
                },
              },
            },
          ],
        },
        WebhookEndpointCreate: fromZod(webhookEndpointCreateSchema),
        WebhookEndpointPatch: fromZod(webhookEndpointPatchSchema),
        WebhookRotateSecret: fromZod(webhookRotateSecretSchema),
        WebhookTestDelivery: fromZod(webhookTestDeliverySchema),
        WebhookTestResult: {
          type: "object",
          required: ["object", "delivery_id", "ok", "outcome", "attempts"],
          properties: {
            object: { type: "string", const: "webhook_test_result" },
            delivery_id: uuid,
            ok: { type: "boolean" },
            outcome: {
              type: "string",
              enum: ["delivered", "retry_scheduled", "dead"],
            },
            attempts: { type: "integer" },
            response_status: nullable({ type: "integer" }),
            response_snippet: nullable({ type: "string" }),
            error: nullable({ type: "string" }),
            event: {
              type: "object",
              properties: {
                id: { type: "string" },
                type: { type: "string" },
                created_at: isoDateTime,
              },
            },
          },
        },
        UploadJob: {
          type: "object",
          required: [
            "id",
            "status",
            "file_name",
            "content_type",
            "size_bytes",
            "created_at",
            "updated_at",
          ],
          properties: {
            object: { type: "string", const: "upload_job" },
            id: uuid,
            status: {
              type: "string",
              enum: ["awaiting_upload", "queued", "processing", "done", "error"],
            },
            file_name: { type: "string" },
            content_type: { type: "string" },
            size_bytes: { type: "integer" },
            hint: { type: "object" },
            attempts: { type: "integer" },
            invoice_id: nullable(uuid),
            error_code: nullable({ type: "string" }),
            error_message: nullable({ type: "string" }),
            created_at: isoDateTime,
            updated_at: isoDateTime,
          },
        },
        UploadJobCreated: {
          allOf: [
            { $ref: "#/components/schemas/UploadJob" },
            {
              type: "object",
              required: ["upload_id", "upload"],
              properties: {
                upload_id: uuid,
                upload: {
                  type: "object",
                  required: ["url", "method", "headers", "expires_in_seconds"],
                  properties: {
                    url: { type: "string", format: "uri" },
                    method: { type: "string", const: "PUT" },
                    headers: { type: "object" },
                    expires_in_seconds: { type: "integer" },
                  },
                },
              },
            },
          ],
        },
        UploadCreate: fromZod(uploadCreateSchema),
        UploadProcess: fromZod(uploadProcessSchema),
        WebhookEventEnvelope: {
          type: "object",
          description:
            "Shape of the JSON body delivered to every webhook endpoint. " +
            "Verify the `X-Involoops-Signature` header before trusting.",
          required: ["id", "type", "version", "created_at", "data"],
          properties: {
            id: { type: "string", example: "evt_01HX..." },
            type: { $ref: "#/components/schemas/WebhookEventType" },
            version: { type: "integer", const: 1 },
            created_at: isoDateTime,
            api_version: { type: "string", const: "v1" },
            data: { type: "object" },
            previous_attributes: {
              type: ["object", "null"],
              description:
                "For `*.updated` events, sparse object of changed fields' prior values.",
            },
            request: {
              type: ["object", "null"],
              properties: { id: { type: "string" } },
            },
          },
        },
      },
    },
    paths: {
      "/auth/login": {
        post: {
          operationId: "auth.login",
          summary: "Sign in from the phone app",
          tags: ["Auth"],
          security: [],
          description:
            "Email and password. When MFA is on and mfa_code is omitted, returns { mfa_required: true } and no token.",
          responses: { "200": { description: "Tokens, or mfa_required" } },
        },
      },
      "/auth/refresh": {
        post: {
          operationId: "auth.refresh",
          summary: "Rotate a device refresh token",
          tags: ["Auth"],
          security: [],
          responses: { "200": { description: "New access and refresh tokens" } },
        },
      },
      "/auth/logout": {
        post: {
          operationId: "auth.logout",
          summary: "Revoke a device session",
          tags: ["Auth"],
          security: [],
          responses: { "204": { description: "Signed out" } },
        },
      },
      "/dashboard": {
        get: op({
          operationId: "dashboard.get",
          summary: "Home numbers for the phone",
          description:
            "This month's issued income and approved expenses, in the user's display currency, plus pending, duplicates, and unpaid documents.",
          tags: ["Expenses"],
          scope: "invoices:read",
          responses: { "200": { description: "Dashboard summary" } },
        }),
      },
      "/duplicates": {
        get: op({
          operationId: "duplicates.list",
          summary: "Expense invoices that look like duplicates",
          tags: ["Expenses"],
          scope: "invoices:read",
          responses: { "200": { description: "Duplicate groups" } },
        }),
      },
      "/invoices": {
        get: op({
          operationId: "invoices.list",
          summary: "List expense invoices",
          description: "Filter with status=pending for the review queue.",
          tags: ["Expenses"],
          scope: "invoices:read",
          responses: { "200": { description: "Page of invoices" } },
        }),
      },
      "/invoices/{id}": {
        get: op({
          operationId: "invoices.get",
          summary: "Get one expense invoice",
          description: "Includes a short-lived preview_url for the stored file.",
          tags: ["Expenses"],
          scope: "invoices:read",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: { "200": { description: "Invoice" } },
        }),
        patch: op({
          operationId: "invoices.patch",
          summary: "Correct a pending expense",
          description: "Pending invoices only.",
          tags: ["Expenses"],
          scope: "invoices:write",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: { "200": { description: "Updated invoice" } },
        }),
      },
      "/invoices/{id}/approve": {
        post: op({
          operationId: "invoices.approve",
          summary: "Approve a pending expense",
          description: "Creates a vendor from vendor_name or the suggested name when none is linked.",
          tags: ["Expenses"],
          scope: "invoices:write",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: { "200": { description: "Approved invoice" } },
        }),
      },
      "/invoices/{id}/reject": {
        post: op({
          operationId: "invoices.reject",
          summary: "Reject a pending expense",
          tags: ["Expenses"],
          scope: "invoices:write",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: { "200": { description: "Rejected invoice" } },
        }),
      },
      "/health": {
        get: {
          operationId: "health.check",
          summary: "Liveness probe",
          description:
            "Unauthenticated. Returns `{status:'ok', version, request_id}` when " +
            "the API process is up. Use it as your monitoring heartbeat — it does " +
            "not touch the database, so a 200 here does not guarantee write paths " +
            "are healthy.",
          tags: ["Meta"],
          security: [],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", const: "ok" },
                      version: { type: "string" },
                      request_id: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/me": {
        get: op({
          operationId: "me.get",
          summary: "Identity of the calling key",
          description:
            "Returns the user the bearer key belongs to and the key's metadata " +
            "(id, friendly name, mode, granted scopes). Useful for SDKs to verify " +
            "credentials at startup and for end users to confirm which key they " +
            "are operating under.",
          tags: ["Meta"],
          scope: "me:read",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      user: {
                        type: "object",
                        properties: {
                          id: uuid,
                          email: {
                            type: "string",
                            format: "email",
                            example: "user@example.com",
                          },
                          name: nullable({ type: "string" }),
                        },
                      },
                      api_key: {
                        type: "object",
                        properties: {
                          id: uuid,
                          name: { type: "string" },
                          mode: { type: "string", enum: ["live", "test"] },
                          scopes: {
                            type: "array",
                            items: { $ref: "#/components/schemas/AvailableScope" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            ...standardErrors,
          },
        }),
      },
      "/business-entity": {
        get: op({
          operationId: "businessEntity.get",
          summary: "Get the issuing business entity",
          description:
            "Returns the legal entity that issues invoices on this account — " +
            "legal name, registration / Osek Murshe number, entity type, address, " +
            "tax-year start month. The entity is the source of truth for the " +
            "issuer block on every signed PDF and every SHAAM submission. " +
            "Configure it under Settings → Business entity in the UI; it cannot " +
            "be created via this API.",
          tags: ["Business entity"],
          scope: "me:read",
          responses: {
            "200": jsonResponse("BusinessEntity"),
            "404": problemResponse("No business entity for this user."),
            ...standardErrors,
          },
        }),
      },
      "/customers": {
        get: op({
          operationId: "customers.list",
          summary: "List customers",
          description:
            "Cursor-paginated list of customers, newest first. Pass `q` to " +
            "filter by case-insensitive substring match on name / email / " +
            "tax_id. Use `cursor` from the previous response's `page.next_cursor` " +
            "to fetch the next page; `limit` defaults to 50 (max 200).",
          tags: ["Customers"],
          scope: "customers:read",
          parameters: [cursorParam, limitParam, searchQueryParam],
          responses: {
            "200": pageJsonResponse("Customer"),
            ...standardErrors,
          },
        }),
        post: op({
          operationId: "customers.create",
          summary: "Create customer",
          description:
            "Creates a customer record you can later attach to outbound invoices " +
            "via `customer_id`. Only `name` is required; everything else (email, " +
            "phone, address, tax_id, notes) is optional. The `Idempotency-Key` " +
            "header is required — replays within 24h return the original 201 " +
            "without creating a duplicate.",
          tags: ["Customers"],
          scope: "customers:write",
          parameters: [idempotencyKeyHeader],
          requestBody: { schema: { $ref: "#/components/schemas/CustomerCreate" } },
          responses: {
            "201": jsonResponse("Customer", "Created"),
            ...writeErrors,
          },
        }),
      },
      "/customers/{id}": {
        get: op({
          operationId: "customers.get",
          summary: "Get customer",
          description: "Fetch a single customer by id.",
          tags: ["Customers"],
          scope: "customers:read",
          parameters: [idParam],
          responses: {
            "200": jsonResponse("Customer"),
            "404": problemResponse("Not found."),
            ...standardErrors,
          },
        }),
        patch: op({
          operationId: "customers.update",
          summary: "Update customer",
          description:
            "Partial update — send only the fields you want to change. " +
            "Updates do not touch any invoices already issued to this customer; " +
            "those carry an immutable snapshot of the customer's data at issue " +
            "time.",
          tags: ["Customers"],
          scope: "customers:write",
          parameters: [idParam, optionalIdempotencyKeyHeader],
          requestBody: { schema: { $ref: "#/components/schemas/CustomerUpdate" } },
          responses: {
            "200": jsonResponse("Customer"),
            "404": problemResponse("Not found."),
            ...writeErrors,
          },
        }),
        delete: op({
          operationId: "customers.delete",
          summary: "Delete customer",
          description:
            "Removes the customer from the active list. Existing invoices keep " +
            "their snapshotted customer data; nothing about historical billing " +
            "changes. Idempotent — deleting an already-deleted id returns 204.",
          tags: ["Customers"],
          scope: "customers:write",
          parameters: [idParam, optionalIdempotencyKeyHeader],
          responses: {
            "204": { description: "Deleted." },
            "404": problemResponse("Not found."),
            ...standardErrors,
          },
        }),
      },
      "/vendors": {
        get: op({
          operationId: "vendors.list",
          summary: "List vendors",
          description:
            "Cursor-paginated list of vendors that have appeared on inbound " +
            "(expense) invoices for this account. Pass `q` for a substring " +
            "match on name, or `is_income_source=true|false` to filter by " +
            "vendors flagged as income sources. Read-only — vendors are " +
            "auto-created during invoice extraction; manage their aliases / " +
            "rules in the UI.",
          tags: ["Vendors"],
          scope: "vendors:read",
          parameters: [
            cursorParam,
            limitParam,
            searchQueryParam,
            {
              in: "query",
              name: "is_income_source",
              required: false,
              schema: { type: "boolean" },
              description:
                "Filter by the income-source flag set in the UI. `true` returns " +
                "only vendors flagged as income sources (used for inbound revenue " +
                "rather than expenses); `false` returns only non-income vendors. " +
                "Omit to return both.",
            },
          ],
          responses: {
            "200": pageJsonResponse("Vendor"),
            ...standardErrors,
          },
        }),
      },
      "/invoice-templates": {
        get: op({
          operationId: "templates.list",
          summary: "List templates",
          description:
            "Cursor-paginated list of invoice templates. Templates control the " +
            "PDF design (`design_id`), accent colour, logo, business header " +
            "block, default currency / language, and whether VAT is broken out. " +
            "Exactly one template per account is `is_default: true`.",
          tags: ["Templates"],
          scope: "templates:read",
          parameters: [cursorParam, limitParam],
          responses: {
            "200": pageJsonResponse("Template"),
            ...standardErrors,
          },
        }),
        post: op({
          operationId: "templates.create",
          summary: "Create template",
          description:
            "Creates a new invoice template. Setting `is_default: true` will " +
            "atomically clear the flag on whichever template was previously " +
            "default (only one default per account). Use the returned id as " +
            "`template_id` when creating draft invoices to render against this " +
            "design.",
          tags: ["Templates"],
          scope: "templates:write",
          parameters: [idempotencyKeyHeader],
          requestBody: { schema: { $ref: "#/components/schemas/TemplateUpsert" } },
          responses: {
            "201": jsonResponse("Template", "Created"),
            ...writeErrors,
          },
        }),
      },
      "/invoice-templates/{id}": {
        get: op({
          operationId: "templates.get",
          summary: "Get template",
          description: "Fetch a single template by id.",
          tags: ["Templates"],
          scope: "templates:read",
          parameters: [idParam],
          responses: {
            "200": jsonResponse("Template"),
            "404": problemResponse("Not found."),
            ...standardErrors,
          },
        }),
        patch: op({
          operationId: "templates.update",
          summary: "Update template",
          description:
            "Partial update — send only the fields you want to change. Edits " +
            "affect future renders only; PDFs already generated for issued " +
            "invoices are immutable. Promoting a template via `is_default: true` " +
            "atomically demotes the previous default.",
          tags: ["Templates"],
          scope: "templates:write",
          parameters: [idParam, optionalIdempotencyKeyHeader],
          requestBody: { schema: { $ref: "#/components/schemas/TemplateUpsert" } },
          responses: {
            "200": jsonResponse("Template"),
            "404": problemResponse("Not found."),
            ...writeErrors,
          },
        }),
        delete: op({
          operationId: "templates.delete",
          summary: "Delete template",
          description:
            "Deletes a template. Issued invoices that referenced it keep their " +
            "frozen render — no historical PDFs are affected. You cannot delete " +
            "the only remaining template; promote another one to default first.",
          tags: ["Templates"],
          scope: "templates:write",
          parameters: [idParam, optionalIdempotencyKeyHeader],
          responses: {
            "204": { description: "Deleted." },
            "404": problemResponse("Not found."),
            ...standardErrors,
          },
        }),
      },
      "/outbound-invoices": {
        get: op({
          operationId: "outboundInvoices.list",
          summary: "List outbound invoices",
          description:
            "Cursor-paginated list of outbound documents (drafts, issued " +
            "invoices, credit notes), newest first. Each row carries a " +
            "lightweight summary — formatted_number, document_type, status, " +
            "totals, customer reference. Fetch the full document with " +
            "`GET /outbound-invoices/{id}`.",
          tags: ["Outbound invoices"],
          scope: "outbound:read",
          parameters: [cursorParam, limitParam],
          responses: {
            "200": pageJsonResponse("OutboundInvoiceListRow"),
            ...standardErrors,
          },
        }),
        post: op({
          operationId: "outboundInvoices.create",
          summary: "Create draft invoice",
          description:
            "Creates an editable draft. The gapless invoice number is allocated " +
            "now (so two parallel drafts get different numbers), but nothing is " +
            "signed and no PDF is generated yet — drafts can be patched or " +
            "deleted freely. Call `POST /outbound-invoices/{id}/issue` when you " +
            "are ready to lock the document.",
          tags: ["Outbound invoices"],
          scope: "outbound:write",
          parameters: [idempotencyKeyHeader],
          requestBody: {
            schema: { $ref: "#/components/schemas/OutboundInvoiceCreate" },
          },
          responses: {
            "201": jsonResponse("OutboundInvoice", "Draft created"),
            ...writeErrors,
          },
        }),
      },
      "/outbound-invoices/{id}": {
        get: op({
          operationId: "outboundInvoices.get",
          summary: "Get outbound invoice",
          description:
            "Fetch the full canonical document — line items, totals, status, " +
            "customer snapshot, and (for issued documents) signing metadata. " +
            "Drafts and issued invoices share the same shape; check `status` " +
            "to tell them apart.",
          tags: ["Outbound invoices"],
          scope: "outbound:read",
          parameters: [idParam],
          responses: {
            "200": jsonResponse("OutboundInvoice"),
            "404": problemResponse("Not found."),
            ...standardErrors,
          },
        }),
        patch: op({
          operationId: "outboundInvoices.update",
          summary: "Update draft invoice",
          description:
            "Drafts only. Issued documents are immutable per Spec 04 — issue a credit note instead.",
          tags: ["Outbound invoices"],
          scope: "outbound:write",
          parameters: [idParam, optionalIdempotencyKeyHeader],
          requestBody: {
            schema: { $ref: "#/components/schemas/OutboundInvoiceDraftPatch" },
          },
          responses: {
            "200": jsonResponse("OutboundInvoice"),
            "404": problemResponse("Not found."),
            ...writeErrors,
          },
        }),
        delete: op({
          operationId: "outboundInvoices.delete",
          summary: "Soft-delete draft invoice",
          description: "Drafts only. Sets `status=voided` and `deleted_at`.",
          tags: ["Outbound invoices"],
          scope: "outbound:write",
          parameters: [idParam, optionalIdempotencyKeyHeader],
          responses: {
            "204": { description: "Deleted." },
            "404": problemResponse("Not found."),
            ...writeErrors,
          },
        }),
      },
      "/outbound-invoices/{id}/issue": {
        post: op({
          operationId: "outboundInvoices.issue",
          summary: "Issue (sign) a draft",
          description:
            "Signs the document, archives the canonical JSON + PDF, and submits to SHAAM " +
            "where applicable. Idempotency-Key required. The gapless number was already " +
            "allocated at draft creation.",
          tags: ["Outbound invoices"],
          scope: "outbound:issue",
          parameters: [idParam, idempotencyKeyHeader],
          requestBody: {
            required: false,
            schema: { $ref: "#/components/schemas/OutboundInvoiceIssue" },
          },
          responses: {
            "200": {
              description: "Issued.",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/OutboundInvoice" },
                      {
                        type: "object",
                        properties: {
                          signed_at: isoDateTime,
                          signing_key_id: { type: "string" },
                          archive_chain_sequence: { type: "integer" },
                        },
                      },
                    ],
                  },
                },
              },
            },
            "404": problemResponse("Not found."),
            "409": problemResponse("Only draft invoices can be issued."),
            ...standardErrors,
          },
        }),
      },
      "/outbound-invoices/{id}/send": {
        post: op({
          operationId: "outboundInvoices.send",
          summary: "Email invoice to recipient (via SES with PDF attached)",
          description:
            "Delivers the invoice PDF as a MIME attachment (Xero/FreshBooks-style) via SES. " +
            "The PDF is re-rendered on demand so the recipient always gets the signed " +
            "canonical content. Status transitions to `sent` on first send (firing " +
            "`outbound_invoice.sent`); re-sends refresh `sent_at` but leave status alone. " +
            "Refuses draft/voided invoices.",
          tags: ["Outbound invoices"],
          scope: "outbound:issue",
          parameters: [idParam, idempotencyKeyHeader],
          requestBody: {
            schema: { $ref: "#/components/schemas/OutboundInvoiceSend" },
          },
          responses: {
            "200": jsonResponse("OutboundInvoiceSendResult"),
            "404": problemResponse("Not found."),
            ...writeErrors,
          },
        }),
      },
      "/outbound-invoices/{id}/credit-note": {
        post: op({
          operationId: "outboundInvoices.creditNote",
          summary: "Issue a credit note against this invoice",
          description:
            "Allocates a fresh CREDIT_INVOICE sequence, signs + archives the credit " +
            "note, and decrements the original's `net_of_credits_amount` under a " +
            "FOR UPDATE lock. When remaining reaches zero, the original is voided. " +
            "Returns the credit note document.",
          tags: ["Outbound invoices"],
          scope: "outbound:issue",
          parameters: [idParam, idempotencyKeyHeader],
          requestBody: {
            schema: { $ref: "#/components/schemas/OutboundInvoiceCreditNote" },
          },
          responses: {
            "201": jsonResponse("OutboundInvoice", "Credit note issued"),
            "404": problemResponse("Original not found."),
            ...writeErrors,
          },
        }),
      },
      "/outbound-invoices/{id}/mark-paid": {
        post: op({
          operationId: "outboundInvoices.markPaid",
          summary: "Mark invoice as paid",
          description:
            "Records that the invoice has been paid (manual reconciliation — no " +
            "payment processor is involved). Transitions status `issued`/`sent` " +
            "→ `paid` and stamps `paid_at`. Fires `outbound_invoice.paid`. " +
            "Refuses drafts and already-voided invoices (returns 409).",
          tags: ["Outbound invoices"],
          scope: "outbound:issue",
          parameters: [idParam, idempotencyKeyHeader],
          requestBody: {
            required: false,
            schema: { $ref: "#/components/schemas/OutboundInvoiceMarkPaid" },
          },
          responses: {
            "200": jsonResponse("OutboundInvoice"),
            "404": problemResponse("Not found."),
            "409": problemResponse("Illegal status transition."),
            ...standardErrors,
          },
        }),
      },
      "/outbound-invoices/{id}/reverse-charge": {
        get: op({
          operationId: "outboundInvoices.reverseCharge.get",
          summary: "Reverse-charge state of a document",
          description:
            "Whether the reverse-charge switch is on, the seller's " +
            "responsibility acknowledgement text (in the document's language), " +
            "and the newest buyer-consent request with its state (`pending` / " +
            "`signed` / `expired` / `revoked` / `stale`). Issuing a " +
            "reverse-charge draft requires a `signed` consent that still " +
            "matches the draft.",
          tags: ["Outbound invoices"],
          scope: "outbound:read",
          parameters: [idParam],
          responses: {
            "200": { description: "Reverse-charge state" },
            "404": problemResponse("Not found."),
            ...standardErrors,
          },
        }),
        post: op({
          operationId: "outboundInvoices.reverseCharge.toggle",
          summary: "Turn reverse charge on or off for a draft",
          description:
            "`enable` zeroes the VAT (the buyer self-accounts for it; tax " +
            "invoice / invoice-receipt drafts only, customer tax id required). " +
            "`disable` restores the statutory rate. Returns the same body as GET.",
          tags: ["Outbound invoices"],
          scope: "outbound:write",
          parameters: [idParam, idempotencyKeyHeader],
          requestBody: {
            required: true,
            schema: { $ref: "#/components/schemas/ReverseChargeToggle" },
          },
          responses: {
            "200": { description: "Reverse-charge state after the change" },
            "404": problemResponse("Not found."),
            "422": problemResponse("Not a draft, wrong document type, or customer tax id missing."),
            ...standardErrors,
          },
        }),
      },
      "/outbound-invoices/{id}/reverse-charge/consent": {
        post: op({
          operationId: "outboundInvoices.reverseCharge.requestConsent",
          summary: "Email the buyer a reverse-charge consent to sign",
          description:
            "Creates a signature request and emails it to the buyer. The " +
            "signature link is also returned — the raw token is never stored, " +
            "so this response is the only chance to capture it (e.g. to share " +
            "over WhatsApp when email fails). `seller_acknowledged` must be " +
            "true, attesting the seller accepted the acknowledgement text " +
            "from GET .../reverse-charge.",
          tags: ["Outbound invoices"],
          scope: "outbound:write",
          parameters: [idParam, idempotencyKeyHeader],
          requestBody: {
            required: true,
            schema: { $ref: "#/components/schemas/ReverseChargeConsentRequest" },
          },
          responses: {
            "200": { description: "Signature link, recipient, expiry, email delivery result" },
            "404": problemResponse("Not found."),
            "422": problemResponse("Acknowledgement missing, or the draft is not eligible."),
            ...standardErrors,
          },
        }),
      },
      "/outbound-invoices/{id}/shaam-decision": {
        post: op({
          operationId: "outboundInvoices.shaamDecision",
          summary: "Record the statutory choice after a SHAAM refusal",
          description:
            "When POST /issue fails with 422 `shaam_rejected` / `shaam_held`, " +
            "`meta.options` lists the seller's legal options. This endpoint " +
            "executes `cancel` (void the document and report the cancellation " +
            "to the ITA) or `hearing` (report that a hearing was requested; " +
            "the hearing itself is conducted at the Tax Authority). " +
            "`issue_without_allocation` goes to POST /issue as `on_rejection`; " +
            "reverse charge is only available in the web app.",
          tags: ["Outbound invoices"],
          scope: "outbound:issue",
          parameters: [idParam, idempotencyKeyHeader],
          requestBody: {
            required: true,
            schema: { $ref: "#/components/schemas/OutboundInvoiceShaamDecision" },
          },
          responses: {
            "200": { description: "Decision recorded" },
            "404": problemResponse("Not found."),
            "422": problemResponse("The decision cannot be applied to this document."),
            ...standardErrors,
          },
        }),
      },
      "/outbound-invoices/{id}/void": {
        post: op({
          operationId: "outboundInvoices.void",
          summary: "Void invoice",
          description:
            "Voids an issued receipt, proforma or delivery note. The number " +
            "stays burned for audit — voiding does not free it for re-use. " +
            "Tax invoices, tax invoice-receipts and credit invoices cannot be " +
            "voided (422 `cannot_void_document_type`): cancel them with a credit " +
            "note via `POST /outbound-invoices/{id}/credit-note`. Fires " +
            "`outbound_invoice.voided`. Optional `reason` is stored on the audit row.",
          tags: ["Outbound invoices"],
          scope: "outbound:issue",
          parameters: [idParam, idempotencyKeyHeader],
          requestBody: {
            required: false,
            schema: { $ref: "#/components/schemas/OutboundInvoiceVoid" },
          },
          responses: {
            "200": jsonResponse("OutboundInvoice"),
            "404": problemResponse("Not found."),
            "409": problemResponse("Illegal status transition."),
            "422": problemResponse("Tax documents are cancelled with a credit note, not voided."),
            ...standardErrors,
          },
        }),
      },
      "/webhook-endpoints": {
        get: op({
          operationId: "webhookEndpoints.list",
          summary: "List webhook endpoints",
          description:
            "Cursor-paginated list of registered webhook receivers — url, " +
            "subscribed events, active flag, last delivery status, " +
            "consecutive-failure counter, and the secret hint (last 4 chars). " +
            "The full signing secret is only returned on create / rotate.",
          tags: ["Webhooks"],
          scope: "webhooks:write",
          parameters: [cursorParam, limitParam],
          responses: {
            "200": pageJsonResponse("WebhookEndpoint"),
            ...standardErrors,
          },
        }),
        post: op({
          operationId: "webhookEndpoints.create",
          summary: "Register webhook endpoint",
          description:
            "Returns the plaintext signing secret exactly once in the `secret` field. " +
            "Subsequent reads show only `secret_hint`.",
          tags: ["Webhooks"],
          scope: "webhooks:write",
          parameters: [idempotencyKeyHeader],
          requestBody: {
            schema: { $ref: "#/components/schemas/WebhookEndpointCreate" },
          },
          responses: {
            "201": jsonResponse("WebhookEndpointWithSecret", "Created"),
            ...writeErrors,
          },
        }),
      },
      "/webhook-endpoints/{id}": {
        get: op({
          operationId: "webhookEndpoints.get",
          summary: "Get webhook endpoint",
          description:
            "Fetch a single webhook endpoint. The full signing secret is never " +
            "returned here — only `secret_hint`. Use `POST /webhook-endpoints/{id}/rotate-secret` " +
            "if you have lost the original.",
          tags: ["Webhooks"],
          scope: "webhooks:write",
          parameters: [idParam],
          responses: {
            "200": jsonResponse("WebhookEndpoint"),
            "404": problemResponse("Not found."),
            ...standardErrors,
          },
        }),
        patch: op({
          operationId: "webhookEndpoints.update",
          summary: "Update webhook endpoint",
          description:
            "Setting `active: true` on a previously auto-disabled endpoint clears " +
            "`disabled_at` / `disabled_reason` / `consecutive_failures` so the worker retries it.",
          tags: ["Webhooks"],
          scope: "webhooks:write",
          parameters: [idParam, optionalIdempotencyKeyHeader],
          requestBody: {
            schema: { $ref: "#/components/schemas/WebhookEndpointPatch" },
          },
          responses: {
            "200": jsonResponse("WebhookEndpoint"),
            "404": problemResponse("Not found."),
            ...writeErrors,
          },
        }),
        delete: op({
          operationId: "webhookEndpoints.delete",
          summary: "Delete webhook endpoint",
          description:
            "Permanently removes the receiver. In-flight deliveries already " +
            "queued for it are dropped. Past deliveries stay in the audit log. " +
            "Idempotent — deleting an already-deleted id returns 204.",
          tags: ["Webhooks"],
          scope: "webhooks:write",
          parameters: [idParam, optionalIdempotencyKeyHeader],
          responses: {
            "204": { description: "Deleted." },
            "404": problemResponse("Not found."),
            ...standardErrors,
          },
        }),
      },
      "/webhook-endpoints/{id}/test": {
        post: op({
          operationId: "webhookEndpoints.test",
          summary: "Fire a test delivery inline",
          description:
            "Immediately delivers a synthetic `event.test` payload (or any event_type you pass) " +
            "to the endpoint and returns the receiver's response in-band. Useful when wiring up " +
            "a new receiver — no need to issue a real invoice. Test deliveries carry " +
            "`X-Involoops-Test: true` and do NOT count toward the endpoint's " +
            "consecutive-failure counter.",
          tags: ["Webhooks"],
          scope: "webhooks:write",
          parameters: [idParam, optionalIdempotencyKeyHeader],
          requestBody: {
            required: false,
            schema: { $ref: "#/components/schemas/WebhookTestDelivery" },
          },
          responses: {
            "200": jsonResponse("WebhookTestResult"),
            "404": problemResponse("Not found."),
            ...writeErrors,
            // Narrower 409 message; must come AFTER the spread to win.
            "409": problemResponse("Endpoint is not active."),
          },
        }),
      },
      "/webhook-endpoints/{id}/rotate-secret": {
        post: op({
          operationId: "webhookEndpoints.rotateSecret",
          summary: "Rotate signing secret",
          description:
            "Generates a new signing secret and returns it ONCE. The previous secret " +
            "stops working immediately for outgoing signatures; accept both on your " +
            "receiver until the switchover completes.",
          tags: ["Webhooks"],
          scope: "webhooks:write",
          parameters: [idParam, idempotencyKeyHeader],
          requestBody: {
            required: false,
            schema: { $ref: "#/components/schemas/WebhookRotateSecret" },
          },
          responses: {
            "200": jsonResponse("WebhookEndpointWithSecret"),
            "404": problemResponse("Not found."),
            ...writeErrors,
          },
        }),
      },
      "/uploads": {
        post: op({
          operationId: "uploads.create",
          summary: "Create an upload",
          description:
            "Returns an upload_id you'll use to /process and poll, plus where to send the file bytes \u2014 " +
            "POST them to /uploads/{id}/content, which streams them through the app. Max file size: 25 MB.",
          tags: ["Uploads"],
          scope: "uploads:write",
          parameters: [idempotencyKeyHeader],
          requestBody: { schema: { $ref: "#/components/schemas/UploadCreate" } },
          responses: {
            "201": jsonResponse("UploadJobCreated", "Created"),
            ...writeErrors,
          },
        }),
      },
      "/uploads/{id}": {
        get: op({
          operationId: "uploads.get",
          summary: "Get upload status",
          description:
            "Poll for terminal status (`done` or `error`). For live clients, subscribe to " +
            "`invoice.processed` / `invoice.processing_failed` webhooks instead.",
          tags: ["Uploads"],
          scope: "uploads:write",
          parameters: [idParam],
          responses: {
            "200": jsonResponse("UploadJob"),
            "404": problemResponse("Not found."),
            ...standardErrors,
          },
        }),
      },
      "/uploads/{id}/content": {
        post: op({
          operationId: "uploads.content",
          summary: "Upload the file bytes through the app",
          description:
            "Raw body, Content-Type matching the upload, body length matching size_bytes. " +
            "This is how file bytes reach the API \u2014 POST /uploads returns this URL. Storage has no " +
            "public hostname, so there is no direct-to-storage alternative.",
          tags: ["Uploads"],
          scope: "uploads:write",
          parameters: [idParam],
          responses: {
            "200": jsonResponse("UploadJob"),
            "404": problemResponse("Not found."),
            "415": problemResponse("Content-Type does not match."),
            "422": problemResponse("Empty or wrong-sized body."),
            ...standardErrors,
          },
        }),
      },
      "/uploads/{id}/process": {
        post: op({
          operationId: "uploads.process",
          summary: "Confirm the file was uploaded and enqueue extraction",
          description:
            "Call this after the PUT to the presigned URL completes. " +
            "The server HEADs the S3 object, flips the job to `queued`, and returns 202. " +
            "A cron worker drains the queue and emits `invoice.processed` on success.",
          tags: ["Uploads"],
          scope: "uploads:write",
          parameters: [idParam, idempotencyKeyHeader],
          requestBody: {
            required: false,
            schema: { $ref: "#/components/schemas/UploadProcess" },
          },
          responses: {
            "202": jsonResponse("UploadJob", "Accepted"),
            "404": problemResponse("Not found."),
            ...writeErrors,
            // Narrower-than-default 409 message. Must come AFTER the
            // `...writeErrors` spread so this value wins.
            "409": problemResponse("File not yet visible in storage."),
          },
        }),
      },
      "/outbound-invoices/{id}/pdf": {
        get: op({
          operationId: "outboundInvoices.pdf",
          summary: "Get a short-lived download URL for the invoice PDF",
          description:
            "Returns a URL on this app, valid for `expires_in_seconds` (5 minutes). " +
            "GET that URL with no Authorization header to receive the PDF bytes. " +
            "Drafts have no PDF yet — call this only after `POST /issue`.",
          tags: ["Outbound invoices"],
          scope: "outbound:read",
          parameters: [idParam],
          responses: {
            "200": {
              description: "Signed URL (short-lived).",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["url", "expires_in_seconds"],
                    properties: {
                      url: { type: "string", format: "uri" },
                      expires_in_seconds: { type: "integer" },
                    },
                  },
                },
              },
            },
            "404": problemResponse("Invoice not found, or PDF not yet generated."),
            ...standardErrors,
          },
        }),
      },
    },
  };

  return spec;
}

function jsonResponse(componentName: string, description = "OK") {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${componentName}` },
      },
    },
  };
}

function pageJsonResponse(componentName: string) {
  return {
    description: "OK",
    content: {
      "application/json": {
        schema: pageEnvelope(`#/components/schemas/${componentName}`),
      },
    },
  };
}
