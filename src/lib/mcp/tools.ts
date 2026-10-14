import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, invoiceTemplates, vendors } from "@/db/schema";
import { ApiError, apiErrors, shaamRefusalApiError } from "@/lib/api/errors";
import {
  customerCreateSchema,
  customerUpdateSchema,
  outboundInvoiceCreditNoteSchema,
  outboundInvoiceSendSchema,
} from "@/lib/api/schemas";
import { serializeCustomer } from "@/lib/api/serializers/customer";
import { serializeBusinessEntity } from "@/lib/api/serializers/business-entity";
import { serializeTemplate } from "@/lib/api/serializers/template";
import { serializeVendor } from "@/lib/api/serializers/vendor";
import {
  serializeOutboundInvoice,
  serializeOutboundInvoiceListRow,
} from "@/lib/api/serializers/outbound-invoice";
import {
  mapOutboundDomainError,
  outboundDocumentsLockedApiError,
} from "@/lib/api/outbound-error-mapping";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { mintOutboundPdfDownloadUrl } from "@/lib/outbound/pdf-download-link";
import {
  callerFromUserId,
  createOutboundInvoiceOp,
  deleteOutboundInvoiceOp,
  getOutboundInvoiceByIdOp,
  issueOutboundInvoiceOp,
  listOutboundInvoicesOp,
  queueOutboundInvoiceForDeliveryOp,
  sendOutboundInvoiceByEmailOp,
  updateOutboundInvoiceDraftOp,
  updateOutboundInvoiceStatusOp,
} from "@/lib/outbound/operations";
import {
  callerFromUserIdForCredit,
  issueCreditNoteOp,
} from "@/lib/outbound/credit-note-op";
import { mutatingAnnotations, readOnlyAnnotations, withTitle } from "./annotations";
import { withDeprecatedAliases } from "./deprecated-aliases";
import {
  lineItemsForStorage,
  mcpOutboundInvoiceCreateSchema,
  mcpOutboundInvoiceDraftPatchSchema,
  toMcpOutboundInvoice,
} from "./line-items";
import { requireMcpAuth } from "./auth";
import { registerExpenseAnalyticsTools } from "./expense-tools";
import { runTool } from "./respond";

/** Cached clients still send the pre-rename line field. Not published. */
const UNIT_PRICE_LINE_ALIAS = {
  at: "items[]",
  from: "unitPrice",
  to: "unit_price",
} as const;

const idSchema = z.object({
  id: z.string().uuid().describe("Resource UUID"),
});

const listSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max rows to return (default 25, max 100)"),
  q: z
    .string()
    .max(200)
    .optional()
    .describe("Optional case-insensitive name substring filter"),
});

/**
 * Register InvoLoops MCP tools. Each tool reuses the same domain ops /
 * serializers as `/api/v1` (or expense analytics ops) and enforces the same
 * API-key scopes.
 */
export function registerInvoloopsTools(server: McpServer): void {
  registerExpenseAnalyticsTools(server);

  server.registerTool(
    "get_me",
    withTitle({
      title: "Get Current User",
      description:
        "Return the authenticated InvoLoops user and the calling API key's scopes/mode.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    }),
    async (_args, ctx) =>
      runTool(async () => {
        const { scopes, extra } = requireMcpAuth(ctx, ["me:read"]);
        return {
          object: "me",
          user: {
            id: extra.userId,
            email: extra.userEmail,
            name: extra.userName,
          },
          api_key: {
            id: extra.apiKeyId,
            name: extra.apiKeyName,
            mode: extra.apiKeyMode,
            scopes,
          },
        };
      }),
  );

  server.registerTool(
    "get_business_entity",
    withTitle({
      title: "Get Business Entity",
      description:
        "Return the legal issuing business entity for the authenticated account.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    }),
    async (_args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["me:read"]);
        const entity = await getBusinessEntityForUserOrNull(userId);
        if (!entity) throw apiErrors.notFound("Business entity");
        return serializeBusinessEntity(entity);
      }),
  );

  server.registerTool(
    "list_customers",
    withTitle({
      title: "List Customers",
      description: "List customers for the authenticated account.",
      inputSchema: listSchema,
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["customers:read"]);
        const limit = args.limit ?? 25;
        const q = args.q?.trim() ?? "";
        const filters = [eq(customers.userId, userId)];
        if (q) {
          filters.push(
            sql`lower(${customers.name}) LIKE ${"%" + q.toLowerCase() + "%"}`,
          );
        }
        const rows = await db
          .select()
          .from(customers)
          .where(and(...filters))
          .orderBy(desc(customers.createdAt), desc(customers.id))
          .limit(limit);
        return {
          object: "list",
          data: rows.map(serializeCustomer),
          count: rows.length,
        };
      }),
  );

  server.registerTool(
    "get_customer",
    withTitle({
      title: "Get Customer",
      description: "Fetch a single customer by id.",
      inputSchema: idSchema,
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["customers:read"]);
        const rows = await db
          .select()
          .from(customers)
          .where(and(eq(customers.id, args.id), eq(customers.userId, userId)))
          .limit(1);
        const row = rows[0];
        if (!row) throw apiErrors.notFound("Customer");
        return serializeCustomer(row);
      }),
  );

  server.registerTool(
    "create_customer",
    withTitle({
      title: "Create Customer",
      description:
        "Create a customer. Requires `customers:write`. Name must be unique per account.",
      inputSchema: customerCreateSchema,
      annotations: mutatingAnnotations({ destructive: false, idempotent: false }),
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["customers:write"]);
        try {
          const [row] = await db
            .insert(customers)
            .values({
              userId,
              name: args.name,
              email: args.email ?? null,
              phone: args.phone ?? null,
              address: args.address ?? null,
              taxId: args.tax_id ?? null,
              notes: args.notes ?? null,
            })
            .returning();
          return serializeCustomer(row);
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ApiError({
              code: "conflict",
              status: 409,
              title: "Customer with this name already exists",
            });
          }
          throw err;
        }
      }),
  );

  server.registerTool(
    "update_customer",
    withTitle({
      title: "Update Customer",
      description: "Partially update a customer. Requires `customers:write`.",
      inputSchema: customerUpdateSchema.extend({
        id: z.string().uuid().describe("Customer UUID"),
      }),
      annotations: mutatingAnnotations({ destructive: false, idempotent: true }),
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["customers:write"]);
        const { id, ...body } = args;
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (body.name !== undefined) patch.name = body.name;
        if (body.email !== undefined) patch.email = body.email;
        if (body.phone !== undefined) patch.phone = body.phone;
        if (body.address !== undefined) patch.address = body.address;
        if (body.tax_id !== undefined) patch.taxId = body.tax_id;
        if (body.notes !== undefined) patch.notes = body.notes;
        try {
          const [row] = await db
            .update(customers)
            .set(patch)
            .where(and(eq(customers.id, id), eq(customers.userId, userId)))
            .returning();
          if (!row) throw apiErrors.notFound("Customer");
          return serializeCustomer(row);
        } catch (err) {
          if (err instanceof ApiError) throw err;
          if (isUniqueViolation(err)) {
            throw new ApiError({
              code: "conflict",
              status: 409,
              title: "Another customer with this name already exists",
            });
          }
          throw err;
        }
      }),
  );

  server.registerTool(
    "list_vendors",
    withTitle({
      title: "List Vendors",
      description: "List expense vendors for the authenticated account.",
      inputSchema: listSchema.extend({
        is_income_source: z
          .boolean()
          .optional()
          .describe("When set, filter by income-source flag"),
      }),
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["vendors:read"]);
        const limit = args.limit ?? 25;
        const q = args.q?.trim() ?? "";
        const filters = [eq(vendors.userId, userId)];
        if (q) {
          filters.push(
            sql`lower(${vendors.name}) LIKE ${"%" + q.toLowerCase() + "%"}`,
          );
        }
        if (args.is_income_source === true) {
          filters.push(eq(vendors.isIncomeSource, true));
        } else if (args.is_income_source === false) {
          filters.push(eq(vendors.isIncomeSource, false));
        }
        const rows = await db
          .select()
          .from(vendors)
          .where(and(...filters))
          .orderBy(asc(vendors.name), asc(vendors.id))
          .limit(limit);
        return {
          object: "list",
          data: rows.map(serializeVendor),
          count: rows.length,
        };
      }),
  );

  server.registerTool(
    "list_invoice_templates",
    withTitle({
      title: "List Invoice Templates",
      description: "List outbound invoice templates for the account.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["templates:read"]);
        const limit = args.limit ?? 25;
        const rows = await db
          .select()
          .from(invoiceTemplates)
          .where(eq(invoiceTemplates.userId, userId))
          .orderBy(asc(invoiceTemplates.createdAt), asc(invoiceTemplates.id))
          .limit(limit);
        return {
          object: "list",
          data: rows.map(serializeTemplate),
          count: rows.length,
        };
      }),
  );

  server.registerTool(
    "list_outbound_invoices",
    withTitle({
      title: "List Invoices",
      description:
        "List outbound invoices/receipts (newest first). Soft-deleted drafts are omitted.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:read"]);
        const limit = args.limit ?? 25;
        const caller = await callerFromUserId(userId);
        const all = await listOutboundInvoicesOp(caller);
        const sliced = all.slice(0, limit);
        return {
          object: "list",
          data: sliced.map(serializeOutboundInvoiceListRow),
          count: sliced.length,
        };
      }),
  );

  server.registerTool(
    "get_outbound_invoice",
    withTitle({
      title: "Get Invoice",
      description: "Fetch a single outbound invoice by id (full detail).",
      inputSchema: idSchema,
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:read"]);
        const caller = await callerFromUserId(userId);
        const row = await getOutboundInvoiceByIdOp(caller, args.id);
        if (!row) throw apiErrors.notFound("Outbound invoice");
        return toMcpOutboundInvoice(serializeOutboundInvoice(row));
      }),
  );

  server.registerTool(
    "create_outbound_invoice_draft",
    withTitle({
      title: "Create Invoice Draft",
      description:
        "Create a draft outbound invoice/receipt. Requires `outbound:write`. Issue separately with `issue_outbound_invoice`. `invoice_date` is the value or payment date, not the date printed on the document. The printed issue date is set to the Israel civil date when the draft is issued. Line items use `unit_price`.",
      inputSchema: withDeprecatedAliases(
        mcpOutboundInvoiceCreateSchema,
        "create_outbound_invoice_draft",
        [UNIT_PRICE_LINE_ALIAS],
      ),
      annotations: mutatingAnnotations({ destructive: false, idempotent: false }),
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:write"]);
        const caller = await callerFromUserId(userId);
        try {
          const row = await createOutboundInvoiceOp(caller, {
            documentType: args.document_type,
            templateId: args.template_id ?? null,
            customerId: args.customer_id ?? null,
            invoiceDate: args.invoice_date,
            dueDate: args.due_date ?? null,
            items: lineItemsForStorage(args.items),
            subtotal: args.subtotal,
            vatRate: args.vat_rate,
            vatAmount: args.vat_amount,
            total: args.total,
            currency: args.currency,
            language: args.language,
            notes: args.notes ?? null,
            payments: args.payments,
            referencesDocumentId: args.references_document_id ?? null,
          });
          return toMcpOutboundInvoice(serializeOutboundInvoice(row));
        } catch (err) {
          throw mapOutboundDomainError(err);
        }
      }),
  );

  server.registerTool(
    "update_outbound_invoice_draft",
    withTitle({
      title: "Update Invoice Draft",
      description:
        "Partially update a draft outbound invoice. Only fields you pass are changed. `items` replaces the whole line list. Issued documents are immutable — issue a credit note instead. Requires `outbound:write`. `invoice_date` is the value or payment date, not the printed issue date. Line items use `unit_price`.",
      inputSchema: withDeprecatedAliases(
        mcpOutboundInvoiceDraftPatchSchema.extend({
          id: z.string().uuid().describe("Draft outbound invoice UUID"),
        }),
        "update_outbound_invoice_draft",
        [UNIT_PRICE_LINE_ALIAS],
      ),
      annotations: mutatingAnnotations({ destructive: false, idempotent: true }),
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:write"]);
        const caller = await callerFromUserId(userId);
        const { id, ...body } = args;
        try {
          const row = await updateOutboundInvoiceDraftOp(caller, id, {
            customerId: body.customer_id,
            invoiceDate: body.invoice_date,
            dueDate: body.due_date,
            items: body.items ? lineItemsForStorage(body.items) : undefined,
            subtotal: body.subtotal,
            vatRate: body.vat_rate,
            vatAmount: body.vat_amount,
            total: body.total,
            currency: body.currency,
            language: body.language,
            notes: body.notes,
          });
          return toMcpOutboundInvoice(serializeOutboundInvoice(row));
        } catch (err) {
          throw mapOutboundDomainError(err);
        }
      }),
  );

  server.registerTool(
    "delete_outbound_invoice_draft",
    withTitle({
      title: "Delete Invoice Draft",
      description:
        "Soft-delete a draft outbound invoice. Issued documents cannot be deleted — issue a credit note instead — and neither can a draft that already holds a number (from an issue the Tax Authority refused): issue it, or cancel it through the refusal options. Requires `outbound:write`. Deleting an already-deleted draft returns not-found (the row is hidden by `deletedAt`); it does not error as a crash.",
      inputSchema: idSchema,
      annotations: mutatingAnnotations({ destructive: true, idempotent: true }),
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:write"]);
        const caller = await callerFromUserId(userId);
        try {
          await deleteOutboundInvoiceOp(caller, args.id);
          return {
            object: "outbound_invoice_draft_deleted",
            id: args.id,
            deleted: true,
          };
        } catch (err) {
          throw mapOutboundDomainError(err);
        }
      }),
  );

  server.registerTool(
    "issue_outbound_invoice",
    withTitle({
      title: "Issue Invoice",
      description:
        "Issue (sign + allocate number + archive) a draft outbound invoice. The printed date becomes today's date in Israel and must not be earlier than the previous document of the same type. Payment and value dates may be earlier. If the draft's invoice_date is not today, tell the user before calling this tool: \"The document will be dated today, [today]. The date you entered will be recorded as the payment/value date.\" A tax invoice or tax-invoice receipt with 0% VAT, no reverse charge, and a business that normally charges VAT is refused (422) unless `confirm_zero_vat` is true. Ask the user first — a VAT toggle left off by mistake becomes an irreversible document, and reverse charge is a different path that needs the buyer's signed consent. Requires `outbound:issue`. Calling this on an invoice that is no longer a draft is rejected (409) and does not allocate a second number.",
      inputSchema: idSchema.extend({
        confirm_zero_vat: z
          .boolean()
          .optional()
          .describe(
            "Confirms issuing a tax invoice that carries no VAT (0%) and is not a reverse charge, from a business whose default is VAT-inclusive — e.g. an export or zero-rated supply. Without it, that combination is refused (422).",
          ),
      }),
      annotations: mutatingAnnotations({ destructive: false, idempotent: false }),
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:issue"]);
        const caller = await callerFromUserId(userId);
        const result = await issueOutboundInvoiceOp(caller, args.id, {
          confirmZeroVat: args.confirm_zero_vat === true,
        });
        if (!result.success) {
          if (result.documentsLocked) {
            throw outboundDocumentsLockedApiError();
          }
          if (result.zeroVatConfirmationRequired) {
            throw new ApiError({
              code: "validation_failed",
              status: 422,
              title:
                "Zero-VAT tax invoice needs explicit confirmation (confirm_zero_vat)",
              detail: result.error,
            });
          }
          if (result.shaamRejection) {
            throw shaamRefusalApiError(result);
          }
          if (/not found/i.test(result.error)) {
            throw apiErrors.notFound("Outbound invoice");
          }
          if (result.customerDailyLimit) {
            throw new ApiError({
              code: "rate_limited",
              status: 429,
              title: "Daily limit reached for this customer",
              detail: result.error,
            });
          }
          if (/Only draft invoices can be issued/i.test(result.error)) {
            throw new ApiError({
              code: "conflict",
              status: 409,
              title: "Only draft invoices can be issued",
              detail: result.error,
            });
          }
          if (result.reverseChargeBlocked) {
            throw new ApiError({
              code: "validation_failed",
              status: 422,
              title: "Reverse charge cannot be issued as it stands",
              detail: result.error,
            });
          }
          if (result.customerTaxIdRequired) {
            throw new ApiError({
              code: "validation_failed",
              status: 422,
              title: "Customer tax ID required for an allocation number",
              detail: result.error,
            });
          }
          if (result.dateOrder) {
            throw new ApiError({
              code: "conflict",
              status: 409,
              title: "Document date is earlier than the previous document",
              detail: result.error,
            });
          }
          throw new ApiError({
            code: "internal_error",
            status: 500,
            title: "Failed to issue invoice",
            detail: result.error,
          });
        }
        // Route B: a refused reverse-charge invoice is replaced by a new
        // one, and the new one is what was issued.
        const issuedId = result.replacementInvoiceId ?? args.id;
        const after = await getOutboundInvoiceByIdOp(caller, issuedId);
        return toMcpOutboundInvoice({
          ...(after ? serializeOutboundInvoice(after) : { id: issuedId }),
          ...(result.replacementInvoiceId ? { replaces_invoice_id: args.id } : {}),
          signed_at: result.signedAt.toISOString(),
          signing_key_id: result.keyId,
          archive_chain_sequence: result.archiveChainSequence,
          shaam_status: result.shaamStatus,
          allocation_number: result.allocationNumber,
        });
      }),
  );

  server.registerTool(
    "issue_outbound_credit_note",
    withTitle({
      title: "Issue Credit Note",
      description:
        "Issue a credit note against an issued invoice. `amount` must be ≤ the remaining balance (`net_of_credits_amount`). An amount equal to the remaining balance voids the original. `lines` is optional; omit it for a single synthetic line. Requires `outbound:issue`. Drafts cannot be credited — delete them instead. Each call creates a new credit-note document.",
      inputSchema: outboundInvoiceCreditNoteSchema.extend({
        id: z
          .string()
          .uuid()
          .describe("Original issued outbound invoice UUID to credit"),
      }),
      annotations: mutatingAnnotations({ destructive: true, idempotent: false }),
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:issue"]);
        const caller = await callerFromUserIdForCredit(userId);
        const result = await issueCreditNoteOp(caller, {
          originalInvoiceId: args.id,
          creditAmount: args.amount,
          reason: args.reason,
          lines: args.lines?.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unit_price,
            vatRate: line.vat_rate,
          })),
        });
        if (!result.success) {
          if (result.documentsLocked) {
            throw outboundDocumentsLockedApiError();
          }
          if (/not found/i.test(result.error)) {
            throw apiErrors.notFound("Invoice");
          }
          if (result.customerDailyLimit) {
            throw new ApiError({
              code: "rate_limited",
              status: 429,
              title: "Daily limit reached for this customer",
              detail: result.error,
            });
          }
          if (result.dateOrder) {
            throw new ApiError({
              code: "conflict",
              status: 409,
              title: "Document date is earlier than the previous document",
              detail: result.error,
            });
          }
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title: "Credit note rejected",
            detail: result.error,
          });
        }
        const after = await getOutboundInvoiceByIdOp(caller, result.creditNoteId);
        return toMcpOutboundInvoice({
          ...(after
            ? serializeOutboundInvoice(after)
            : {
                id: result.creditNoteId,
                formatted_number: result.formattedNumber,
              }),
          signed_at: result.signedAt.toISOString(),
          references_document_id: args.id,
        });
      }),
  );

  server.registerTool(
    "send_outbound_invoice",
    withTitle({
      title: "Send Invoice",
      description:
        "Email an issued outbound invoice PDF via SES. Requires `outbound:issue`. Each call sends another email.",
      inputSchema: outboundInvoiceSendSchema.extend({
        id: z.string().uuid().describe("Outbound invoice UUID"),
      }),
      annotations: mutatingAnnotations({ destructive: false, idempotent: false }),
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:issue"]);
        if (args.force && args.queue_for_clear) {
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title: "force and queue_for_clear are mutually exclusive",
          });
        }
        const caller = await callerFromUserId(userId);
        try {
          if (args.queue_for_clear) {
            const queue = await queueOutboundInvoiceForDeliveryOp(caller, {
              invoiceId: args.id,
              to: args.to,
              subject: args.subject,
              body: args.body,
            });
            if (!queue.success) {
              throw new ApiError({
                code: "validation_failed",
                status: 422,
                title: "Queue rejected",
                detail: queue.error,
              });
            }
            return {
              object: "outbound_invoice_queued_delivery",
              status: "queued_for_shaam_clear",
              queued_at: queue.queuedAt,
              recipient: args.to,
            };
          }

          const result = await sendOutboundInvoiceByEmailOp(caller, {
            invoiceId: args.id,
            to: args.to,
            subject: args.subject,
            body: args.body,
            force: args.force ?? false,
            source: "manual",
          });
          if (!result.success) {
            if ("shaamGate" in result) {
              throw new ApiError({
                code: "conflict",
                status: 409,
                title: "SHAAM gate refused the send",
                detail: result.error,
              });
            }
            throw new ApiError({
              code: "validation_failed",
              status: 422,
              title: "Send rejected",
              detail: result.error,
            });
          }
          return {
            object: "outbound_invoice_send_result",
            message_id: result.messageId,
            status: result.newStatus,
            sent_at: result.sentAt,
            recipient: args.to,
            forced: args.force ?? false,
          };
        } catch (err) {
          if (err instanceof ApiError) throw err;
          throw mapOutboundDomainError(err);
        }
      }),
  );

  server.registerTool(
    "mark_outbound_invoice_paid",
    withTitle({
      title: "Mark Invoice Paid",
      description:
        "Mark an issued/sent outbound invoice as paid. Requires `outbound:issue`. Marking an invoice that is already paid leaves it paid.",
      inputSchema: idSchema,
      annotations: mutatingAnnotations({ destructive: false, idempotent: true }),
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:issue"]);
        const caller = await callerFromUserId(userId);
        try {
          const row = await updateOutboundInvoiceStatusOp(
            caller,
            args.id,
            "paid",
          );
          return toMcpOutboundInvoice(serializeOutboundInvoice(row));
        } catch (err) {
          throw mapOutboundDomainError(err);
        }
      }),
  );

  server.registerTool(
    "void_outbound_invoice",
    withTitle({
      title: "Void Invoice",
      description:
        "Void an issued receipt, proforma or delivery note. Requires `outbound:issue`. Tax invoices, tax invoice-receipts and credit invoices cannot be voided — cancel them with issue_outbound_credit_note. Voiding a document that is already void is a no-op and returns the same document.",
      inputSchema: idSchema,
      annotations: mutatingAnnotations({ destructive: true, idempotent: true }),
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:issue"]);
        const caller = await callerFromUserId(userId);
        try {
          const row = await updateOutboundInvoiceStatusOp(
            caller,
            args.id,
            "voided",
          );
          return toMcpOutboundInvoice(serializeOutboundInvoice(row));
        } catch (err) {
          throw mapOutboundDomainError(err);
        }
      }),
  );

  server.registerTool(
    "get_outbound_invoice_pdf_url",
    withTitle({
      title: "Get Invoice PDF URL",
      description:
        "Return a 5-minute download URL for the issued invoice PDF. The link is on involoops.com and streams the file. Drafts have no PDF yet.",
      inputSchema: idSchema,
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["outbound:read"]);
        const caller = await callerFromUserId(userId);
        const row = await getOutboundInvoiceByIdOp(caller, args.id);
        if (!row) throw apiErrors.notFound("Outbound invoice");
        if (!row.pdfUrl) {
          const stillDraft = row.status === "draft";
          throw new ApiError({
            code: "not_found",
            status: 404,
            title: stillDraft ? "PDF not yet generated" : "PDF not yet available",
            detail: stillDraft
              ? "Issue the document first to render a PDF."
              : "The document is issued; the PDF is still being published. Retry shortly.",
          });
        }
        const link = mintOutboundPdfDownloadUrl({
          userId,
          invoiceId: args.id,
        });
        return { url: link.url, expires_in_seconds: link.expiresInSeconds };
      }),
  );
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}
