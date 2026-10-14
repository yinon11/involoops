/**
 * Zod request-body schemas for the public REST API. Centralised so we can
 * generate the OpenAPI spec from the same types via `z.toJSONSchema()`.
 *
 * Conventions (see docs/api/02-conventions.md):
 *   - snake_case JSON property names.
 *   - Decimal money fields are STRINGS to avoid float drift; we validate
 *     with a strict regex and let Postgres parse to numeric(12,2).
 *   - Currency is uppercase ISO-4217 (3 chars).
 *   - Date fields are `YYYY-MM-DD` strings.
 *
 * Per-field `.describe()` / `.meta({ description, example })` calls
 * surface as `description` / `example` in the OpenAPI spec (verified
 * by Zod 4's `z.toJSONSchema`). Keep them current — they show up in
 * Swagger UI, Redoc, generated SDK docstrings, and the deep-link
 * pills on `/developers`.
 */

import { z } from "zod";
import {
  MAX_INVOICE_LINES,
  MAX_INVOICE_NOTES_LENGTH,
  MAX_LINE_DESCRIPTION_LENGTH,
} from "@/lib/documents/invoice-limits";
import { DOCUMENT_TYPES } from "@/lib/documents/types";
import { TEMPLATE_DESIGN_IDS } from "@/types/template";

const decimal = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, "must be a decimal with at most 2 fraction digits");

const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "must be a 3-letter ISO-4217 currency code");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const language = z
  .string()
  .regex(/^[a-z]{2}$/, "must be a 2-letter ISO-639 language code");

// ---------- Customer ----------

export const customerCreateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .describe("Display name shown on issued invoices. Required."),
  email: z
    .string()
    .email()
    .max(255)
    .meta({
      example: "customer@example.com",
      description:
        "Primary contact email. Used as the default `to:` when sending invoices " +
        "by email; the recipient is still required explicitly on each send call.",
    })
    .optional()
    .nullable(),
  phone: z
    .string()
    .max(50)
    .describe("Free-form phone number. Stored verbatim; no E.164 normalisation.")
    .optional()
    .nullable(),
  address: z
    .string()
    .max(2000)
    .describe(
      "Multi-line postal address. Snapshotted onto each issued invoice at " +
        "issue time — later edits do not rewrite history.",
    )
    .optional()
    .nullable(),
  tax_id: z
    .string()
    .max(100)
    .describe(
      "Customer's tax / VAT registration number (e.g. Israeli ח.פ. or Osek " +
        "Murshe number). Printed on the invoice and required for B2B invoices " +
        "above SHAAM thresholds.",
    )
    .optional()
    .nullable(),
  notes: z
    .string()
    .max(4000)
    .describe(
      "Internal notes — never rendered on issued PDFs or sent to the customer.",
    )
    .optional()
    .nullable(),
});
export type CustomerCreate = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema.partial();
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;

// ---------- Template ----------

export const templateUpsertSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .describe("Internal label for the template. Not shown on the invoice.")
    .optional(),
  design_id: z
    .enum(TEMPLATE_DESIGN_IDS)
    .describe(
      "Visual layout. Each id is a hand-built renderer in `src/lib/outbound/templates/`.",
    )
    .optional(),
  accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .describe("Hex colour used for headings, totals row, and accent strokes.")
    .optional(),
  logo_url: z
    .string()
    .url()
    .max(1024)
    .describe(
      "Public HTTPS URL for the issuer logo. Fetched at render time and " +
        "embedded into the PDF — host it somewhere stable.",
    )
    .optional()
    .nullable(),
  business_phone: z
    .string()
    .max(50)
    .describe(
      "Issuer phone printed on the invoice header, exactly as given. " +
        "Send an empty string to leave it off the invoice entirely.",
    )
    .optional()
    .nullable(),
  business_email: z
    .string()
    .email()
    .max(255)
    .meta({
      example: "billing@example.com",
      description:
        "Issuer billing email printed on the invoice header, exactly as " +
        "given. Send an empty string to leave it off the invoice entirely.",
    })
    .optional()
    .nullable(),
  business_website: z
    .string()
    .url()
    .max(512)
    .describe("Issuer website URL printed on the invoice header.")
    .optional()
    .nullable(),
  show_vat_breakdown: z
    .boolean()
    .describe(
      "When true, the PDF prints the per-rate VAT breakdown row above the " +
        "total. Disable for Osek Patur templates that don't charge VAT.",
    )
    .optional(),
  show_bank_details: z
    .boolean()
    .describe(
      "When true, documents that request payment (TAX_INVOICE, PROFORMA) " +
        "print the bank-transfer details below the totals. Never printed on " +
        "TAX_INVOICE_RECEIPT, RECEIPT, CREDIT_INVOICE or DELIVERY_NOTE.",
    )
    .optional(),
  bank_account_holder: z
    .string()
    .max(255)
    .describe("Name the transfer should be made out to.")
    .optional()
    .nullable(),
  bank_name: z
    .string()
    .max(120)
    .describe("Bank name, optionally with its code (e.g. `לאומי (10)`).")
    .optional()
    .nullable(),
  bank_branch: z
    .string()
    .max(60)
    .describe("Branch number.")
    .optional()
    .nullable(),
  bank_account_number: z
    .string()
    .max(60)
    .describe("Account number.")
    .optional()
    .nullable(),
  bank_iban: z
    .string()
    .max(60)
    .describe("IBAN, for transfers from abroad.")
    .optional()
    .nullable(),
  bank_swift: z
    .string()
    .max(20)
    .describe("SWIFT / BIC code, for transfers from abroad.")
    .optional()
    .nullable(),
  bank_transfer_note: z
    .string()
    .max(500)
    .describe(
      "Free text printed under the transfer details, e.g. a request to quote " +
        "the document number on the transfer.",
    )
    .optional()
    .nullable(),
  default_currency: currencyCode
    .describe(
      "Default ISO-4217 currency for new invoices created from this template.",
    )
    .optional(),
  default_language: language
    .describe(
      "Default ISO-639 two-letter language for the invoice copy. Currently `en` or `he`.",
    )
    .optional(),
  is_default: z
    .boolean()
    .describe(
      "Promoting `true` atomically demotes whichever template was previously " +
        "default. Exactly one default per account.",
    )
    .optional(),
});
export type TemplateUpsert = z.infer<typeof templateUpsertSchema>;

// ---------- Outbound invoice ----------

const lineItem = z
  .object({
    description: z
      .string()
      .min(1)
      .max(MAX_LINE_DESCRIPTION_LENGTH)
      .describe("Line description printed on the invoice."),
    quantity: z
      .number()
      .positive()
      .describe("Quantity (units, hours, etc.). Must be > 0."),
    unitPrice: z
      .number()
      .min(0)
      .describe("Unit price excluding VAT, in the invoice currency."),
    total: z
      .number()
      .min(0)
      .describe(
        "Line subtotal excluding VAT (`quantity * unitPrice`). The server " +
          "re-derives totals; this is sent for validation and SHAAM canonicalisation.",
      ),
  })
  .describe(
    "A single line on the invoice. Note the camelCase keys (`unitPrice`) — " +
      "carried over from the legacy renderer, kept stable for compatibility.",
  );

const paymentEntry = z
  .object({
    method: z
      .enum([
        "cash",
        "check",
        "card",
        "bank_transfer",
        "withholding_tax",
        "other",
      ])
      .describe("Payment method recorded for this entry."),
    amount: z
      .number()
      .nonnegative()
      .describe("Amount applied in this payment, in `currency`."),
    currency: currencyCode.describe(
      "ISO-4217 currency of this payment. Usually matches the invoice currency.",
    ),
    date: isoDate.describe("Date the payment was received (YYYY-MM-DD)."),
    reference: z
      .string()
      .max(255)
      .describe(
        "Optional free-form reference (cheque number, transaction id, etc.).",
      )
      .optional(),
  })
  .describe(
    "A single payment recorded against the invoice. Pre-paid invoices ship " +
      "with their payments inline; later payments go through `POST /mark-paid`.",
  );

export const outboundInvoiceCreateSchema = z
  .object({
  document_type: z
    .enum(DOCUMENT_TYPES)
    .describe(
      "Document kind — `TAX_INVOICE`, `TAX_INVOICE_RECEIPT`, `RECEIPT`, " +
        "`CREDIT_INVOICE`, `PROFORMA`, `DELIVERY_NOTE`. Each kind has its " +
        "own gapless number sequence and SHAAM doc code. Defaults to " +
        "`TAX_INVOICE` when omitted.",
    )
    .optional(),
  template_id: z
    .string()
    .uuid()
    .describe(
      "Template to render against. Defaults to the account's `is_default` template.",
    )
    .optional()
    .nullable(),
  customer_id: z
    .string()
    .uuid()
    .describe(
      "Customer the invoice is issued to. Required at issue time, but a " +
        "draft can be created without one and the customer linked later.",
    )
    .optional()
    .nullable(),
  invoice_date: isoDate.describe(
    "Value date or payment date (YYYY-MM-DD). This is not the date printed on the document. The printed issue date is set to today's date in Israel when the draft is issued. If this date is not that day, it is kept as the value date on an invoice and as the payment date on a receipt.",
  ),
  due_date: isoDate
    .describe(
      "Payment due date (YYYY-MM-DD). Optional; printed only when set.",
    )
    .optional()
    .nullable(),
  items: z
    .array(lineItem)
    .min(1)
    .max(MAX_INVOICE_LINES)
    .describe("Line items. At least one, capped at 50."),
  subtotal: decimal.describe(
    "Sum of line totals excluding VAT, as a decimal string (e.g. `\"1234.56\"`).",
  ),
  vat_rate: decimal
    .describe(
      "VAT rate applied uniformly to all lines, as a percent decimal " +
        "(e.g. `\"17\"` for 17 %). Omit on Osek Patur invoices.",
    )
    .optional(),
  vat_amount: decimal
    .describe("Total VAT amount as a decimal string. Omit when `vat_rate` is omitted.")
    .optional(),
  total: decimal.describe(
    "Grand total including VAT, as a decimal string. The server re-derives " +
      "and rejects on mismatch.",
  ),
  currency: currencyCode
    .describe(
      "ISO-4217 currency. Defaults to the template's `default_currency` when omitted.",
    )
    .optional(),
  language: language
    .describe(
      "ISO-639 language for the rendered copy. Defaults to the template's " +
        "`default_language` when omitted.",
    )
    .optional(),
  notes: z
    .string()
    .max(MAX_INVOICE_NOTES_LENGTH)
    .describe(
      "Optional notes printed at the bottom of the invoice (payment terms, " +
        "thank-you message, etc.).",
    )
    .optional()
    .nullable(),
  payments: z
    .array(paymentEntry)
    .describe(
      "Payment entries recorded against the document. **Required** when " +
        "`document_type` is `RECEIPT` or `TAX_INVOICE_RECEIPT` — those " +
        "documents are the legal proof of payment received and must list " +
        "the method (cash / check / card / bank_transfer / withholding_tax / other), amount, " +
        "date and a reference for non-cash methods. Their sum must equal " +
        "`total` exactly. **Forbidden** on plain `TAX_INVOICE`, " +
        "`CREDIT_INVOICE`, `PROFORMA`, `DELIVERY_NOTE` (omit the field — " +
        "later payments go through `POST /mark-paid`).",
    )
    .optional(),
  references_document_id: z
    .string()
    .uuid()
    .describe(
      "Set on a `RECEIPT` to settle a previously-issued `TAX_INVOICE`. " +
        "The parent must be in status `issued` or `sent`, owned by the " +
        "same business entity, share the same currency, and still carry " +
        "an outstanding balance. When the receipt is issued and the " +
        "running total clears the balance, the parent invoice flips to " +
        "`paid` automatically.",
    )
    .optional()
    .nullable(),
  })
  // Surface the conditional requirement as a structured 422 with a field
  // path instead of a domain-level throw from `validatePayments`. The
  // operations layer still validates sum/method/reference — this guard
  // is just so OpenAPI consumers see the missing-payments case as a
  // schema error on `payments`, not as an opaque 500/422.
  .superRefine(refineOutboundInvoicePayments);
export type OutboundInvoiceCreate = z.infer<typeof outboundInvoiceCreateSchema>;

/** Shared by the REST create schema and the MCP create schema. */
export function refineOutboundInvoicePayments(
  data: { document_type?: string; payments?: unknown[] },
  ctx: z.RefinementCtx,
) {
  const docType = data.document_type ?? "TAX_INVOICE";
  const requiresPayments =
    docType === "RECEIPT" || docType === "TAX_INVOICE_RECEIPT";
  const forbidsPayments = !requiresPayments;
  const payments = data.payments ?? [];
  if (requiresPayments && payments.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["payments"],
      message:
        `Payments are required for document_type=${docType}. ` +
        "Provide at least one payment entry whose amounts sum to `total`.",
    });
  }
  if (forbidsPayments && payments.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["payments"],
      message:
        `Payments are not allowed on document_type=${docType}. ` +
        "Use `POST /mark-paid` to record payment after issuance, or issue " +
        "a `RECEIPT` / `TAX_INVOICE_RECEIPT`.",
    });
  }
}

export const outboundInvoiceDraftPatchSchema = z.object({
  customer_id: z
    .string()
    .uuid()
    .describe("New customer to attach. Pass `null` to detach.")
    .optional()
    .nullable(),
  invoice_date: isoDate
    .describe(
      "Value date or payment date (YYYY-MM-DD). Not the printed issue date — that is set automatically when the draft is issued.",
    )
    .optional(),
  due_date: isoDate
    .describe("New due date (YYYY-MM-DD), or `null` to clear.")
    .optional()
    .nullable(),
  items: z
    .array(lineItem)
    .min(1)
    .max(MAX_INVOICE_LINES)
    .describe(
      "Replacement line-items array. PATCH replaces the entire list — there " +
        "is no per-line PATCH.",
    )
    .optional(),
  subtotal: decimal
    .describe("New subtotal excluding VAT, as a decimal string.")
    .optional(),
  vat_rate: decimal
    .describe("New VAT rate as a percent decimal string, or omit to leave unchanged.")
    .optional(),
  vat_amount: decimal
    .describe("New total VAT amount as a decimal string.")
    .optional(),
  total: decimal
    .describe("New grand total including VAT, as a decimal string.")
    .optional(),
  currency: currencyCode
    .describe("New ISO-4217 currency.")
    .optional(),
  language: language
    .describe("New ISO-639 language code.")
    .optional(),
  notes: z
    .string()
    .max(MAX_INVOICE_NOTES_LENGTH)
    .describe(
      "Replacement notes string, or `null` to clear. PATCH replaces the value " +
        "wholesale — there is no append.",
    )
    .optional()
    .nullable(),
});
export type OutboundInvoiceDraftPatch = z.infer<typeof outboundInvoiceDraftPatchSchema>;

export const outboundInvoiceMarkPaidSchema = z.object({}).passthrough();
export const outboundInvoiceVoidSchema = z
  .object({
    reason: z
      .string()
      .max(255)
      .describe("Optional free-form reason recorded on the audit row.")
      .optional(),
  })
  .passthrough();
export const outboundInvoiceIssueSchema = z
  .object({
    confirm_zero_vat: z
      .boolean()
      .describe(
        "Confirms issuing a tax invoice that carries no VAT (0%) and is not a reverse charge, from a business whose default is VAT-inclusive — e.g. an export or zero-rated supply. Without it, that combination is refused (422) so a VAT toggle left off by mistake cannot become an irreversible document.",
      )
      .optional(),
    on_rejection: z
      .enum(["issue_without_allocation"])
      .describe(
        "Retry choice after a SHAAM refusal (422 `shaam_rejected`/`shaam_held` " +
          "whose `meta.options` includes `issue_without_allocation`): reissue " +
          "the same draft and finalize the document without an allocation " +
          "number, as the law permits. Never pass it speculatively on a " +
          "first issue.",
      )
      .optional(),
  })
  .passthrough();

export const outboundInvoiceSendSchema = z.object({
  to: z
    .string()
    .email()
    .meta({
      example: "customer@example.com",
      description:
        "Recipient email address. Required — falls back to the customer's " +
        "email client-side if omitted there, but the API always takes it " +
        "explicitly for deterministic audit trails.",
    }),
  subject: z
    .string()
    .min(1)
    .max(255)
    .meta({
      example: "Your invoice INV-2026-0042",
      description:
        "Email subject line. Substitute the invoice's `formatted_number` for " +
        "easy threading on the recipient's side.",
    }),
  body: z
    .string()
    .max(10_000)
    .meta({
      example:
        "Hi,\n\nPlease find attached invoice INV-2026-0042. Let us know if you have any questions.\n\nThanks!",
      description:
        "Plain-text email body. The signed invoice PDF is attached via SES " +
        "raw MIME; you do not need to link to it from the body.",
    }),
  force: z
    .boolean()
    .describe(
      "Override the SHAAM gate. When the invoice is `shaam_status` " +
        "PENDING / OUTAGE_ISSUED / REJECTED / HELD, the send is refused " +
        "with HTTP 409 by default. Pass `true` to bypass the gate — the " +
        "customer-facing PDF will not include an allocation number. " +
        "Mutually exclusive with `queue_for_clear`.",
    )
    .optional(),
  queue_for_clear: z
    .boolean()
    .describe(
      "Capture the send intent and let the SHAAM retry cron fire it once " +
        "the allocation clears. Only meaningful when the SHAAM gate would " +
        "otherwise refuse the send. Mutually exclusive with `force`.",
    )
    .optional(),
});
export type OutboundInvoiceSend = z.infer<typeof outboundInvoiceSendSchema>;

export const outboundInvoiceShaamDecisionSchema = z.object({
  decision: z
    .enum(["cancel", "hearing"])
    .describe(
      "Statutory choice after a SHAAM refusal. `cancel` voids the document " +
        "and reports the cancellation to the ITA; `hearing` reports that the " +
        "seller requests a hearing (the hearing itself is conducted at the " +
        "Tax Authority). The remaining options go elsewhere: " +
        "`issue_without_allocation` is passed to POST /issue as " +
        "`on_rejection`, and reverse charge is only available in the web app.",
    ),
});
export type OutboundInvoiceShaamDecision = z.infer<
  typeof outboundInvoiceShaamDecisionSchema
>;

export const reverseChargeToggleSchema = z.object({
  action: z
    .enum(["enable", "disable"])
    .describe(
      "`enable` turns a draft tax invoice / invoice-receipt into a reverse-" +
        "charge document (VAT drops to 0; the buyer self-accounts for it). " +
        "`disable` restores the statutory VAT rate. Drafts only.",
    ),
});
export type ReverseChargeToggle = z.infer<typeof reverseChargeToggleSchema>;

export const reverseChargeConsentRequestSchema = z.object({
  seller_acknowledged: z
    .boolean()
    .describe(
      "Must be `true`: confirms the seller read and accepted the " +
        "responsibility acknowledgement returned by GET .../reverse-charge " +
        "(`seller_acknowledgement`). Requests without it are refused.",
    ),
  recipient_email: z
    .string()
    .email()
    .max(255)
    .describe(
      "Where to send the signature request. Defaults to the customer's email.",
    )
    .optional()
    .nullable(),
});
export type ReverseChargeConsentRequest = z.infer<
  typeof reverseChargeConsentRequestSchema
>;

export const outboundInvoiceCreditNoteSchema = z.object({
  amount: decimal.describe(
    "Credit amount as a decimal string (e.g. `\"5310.00\"`). Must be ≤ the " +
      "original invoice's `net_of_credits_amount`. Pass exactly equal to " +
      "fully reverse and void the original.",
  ),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "Free-form reason printed on the credit note (e.g. \"Goods returned\", " +
        "\"Pricing error\"). Required — credit notes always carry a reason.",
    ),
  lines: z
    .array(
      z.object({
        description: z
          .string()
          .min(1)
          .max(MAX_LINE_DESCRIPTION_LENGTH)
          .describe("Line description printed on the credit note."),
        quantity: decimal.describe("Quantity as a decimal string."),
        unit_price: decimal.describe(
          "Unit price excluding VAT, as a decimal string.",
        ),
        vat_rate: decimal.describe(
          "Per-line VAT rate as a percent decimal string (e.g. `\"17\"`).",
        ),
      }),
    )
    .max(MAX_INVOICE_LINES)
    .describe(
      "Optional per-line breakdown for partial credits. When omitted a single " +
        "synthetic line equal to `amount` is created.",
    )
    .optional(),
});
export type OutboundInvoiceCreditNote = z.infer<
  typeof outboundInvoiceCreditNoteSchema
>;

// ---------- Webhook endpoint ----------

export const webhookEndpointCreateSchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .describe(
      "HTTPS URL we POST events to. Must terminate TLS (plain HTTP is " +
        "rejected). Receivers should respond 2xx within 10 s.",
    ),
  description: z
    .string()
    .max(500)
    .describe("Optional internal label shown in the dashboard.")
    .optional()
    .nullable(),
  events: z
    .array(z.string().max(100))
    .min(1)
    .max(32)
    .describe(
      "Event types to subscribe to (e.g. `outbound_invoice.issued`, " +
        "`invoice.processed`). Use `[\"*\"]` to receive every event type.",
    ),
});
export type WebhookEndpointCreate = z.infer<typeof webhookEndpointCreateSchema>;

export const webhookEndpointPatchSchema = z.object({
  description: z
    .string()
    .max(500)
    .describe("New label, or `null` to clear.")
    .optional()
    .nullable(),
  events: z
    .array(z.string().max(100))
    .min(1)
    .max(32)
    .describe("Replacement event subscription list. Replaces the whole list.")
    .optional(),
  active: z
    .boolean()
    .describe(
      "Toggle delivery. Setting `true` on a previously auto-disabled endpoint " +
        "clears `disabled_at` / `disabled_reason` / `consecutive_failures` so " +
        "the worker retries it.",
    )
    .optional(),
});
export type WebhookEndpointPatch = z.infer<typeof webhookEndpointPatchSchema>;

export const webhookRotateSecretSchema = z.object({}).passthrough();

export const webhookTestDeliverySchema = z.object({
  event_type: z
    .string()
    .max(100)
    .describe(
      "Event type to mimic in the test payload. Must be one of the " +
        "endpoint's subscribed events, or the literal `event.test`. Defaults " +
        "to `event.test`.",
    )
    .optional(),
});

// ---------- Uploads ----------

const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/zip",
] as const;

export const uploadCreateSchema = z.object({
  file_name: z
    .string()
    .min(1)
    .max(512)
    .describe(
      "Original file name. Used for display and for the stored S3 key — " +
        "control characters are stripped.",
    ),
  content_type: z
    .enum(ALLOWED_CONTENT_TYPES)
    .describe(
      "MIME type of the file. Restricted to the supported set so the " +
        "extraction pipeline knows how to handle the bytes.",
    ),
  size_bytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .describe(
      "File size in bytes. Hard cap is 50 MB — matches the web-app ceiling " +
        "and the presigned URL's content-length condition.",
    ),
});
export type UploadCreate = z.infer<typeof uploadCreateSchema>;

export const uploadProcessSchema = z.object({
  type: z
    .enum(["expense", "income"])
    .describe(
      "Hint for the extraction pipeline. `expense` is the default; pass " +
        "`income` for invoices you issued (to route them to the income " +
        "ledger instead of the expense ledger).",
    )
    .optional(),
  vendor_id_hint: z
    .string()
    .uuid()
    .describe(
      "Optional vendor id to bias extraction toward a known vendor's rules / " +
        "aliases when the document is ambiguous.",
    )
    .optional(),
});
export type UploadProcess = z.infer<typeof uploadProcessSchema>;

// ---------- Device sign-in (mobile app) ----------

export const deviceLoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
  mfa_code: z.string().max(40).optional(),
  device_name: z.string().min(1).max(120).optional(),
});
export type DeviceLogin = z.infer<typeof deviceLoginSchema>;

export const deviceRefreshSchema = z.object({
  refresh_token: z.string().min(20).max(200),
});
export type DeviceRefresh = z.infer<typeof deviceRefreshSchema>;

// ---------- Inbound expenses ----------

export const expensePatchSchema = z
  .object({
    vendor_name: z.string().max(255).optional(),
    invoice_number: z.string().max(255).nullable().optional(),
    invoice_date: isoDate.optional(),
    amount: decimal.optional(),
    currency: currencyCode.optional(),
    vat_amount: decimal.nullable().optional(),
    amount_without_vat: decimal.nullable().optional(),
    description: z.string().max(4000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });
export type ExpensePatch = z.infer<typeof expensePatchSchema>;

export const expenseApproveSchema = z.object({
  vendor_name: z.string().max(255).optional(),
});
export type ExpenseApprove = z.infer<typeof expenseApproveSchema>;

export const expenseRejectSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type ExpenseReject = z.infer<typeof expenseRejectSchema>;
