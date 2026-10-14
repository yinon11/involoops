import { z } from "zod";
import {
  outboundInvoiceCreateSchema,
  outboundInvoiceDraftPatchSchema,
  refineOutboundInvoicePayments,
} from "@/lib/api/schemas";
import {
  MAX_INVOICE_LINES,
  MAX_LINE_DESCRIPTION_LENGTH,
} from "@/lib/documents/invoice-limits";

/**
 * MCP line item. Storage and the REST API keep `unitPrice`. These tools
 * speak `unit_price` and translate at this boundary.
 */
const mcpLineItem = z
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
    unit_price: z
      .number()
      .min(0)
      .describe("Unit price excluding VAT, in the invoice currency."),
    total: z
      .number()
      .min(0)
      .describe(
        "Line subtotal excluding VAT (`quantity * unit_price`). The server " +
          "re-derives totals; this is sent for validation and SHAAM canonicalisation.",
      ),
  })
  .describe("A single line on the invoice. Use `unit_price`.");

const mcpLineItems = z
  .array(mcpLineItem)
  .min(1)
  .max(MAX_INVOICE_LINES);

// Rebuild from the REST field shape. `.extend()` / `.safeExtend()` cannot
// replace `items` here: the create schema is refined, and the replacement
// line type is not assignable to the stored `unitPrice` line.
export const mcpOutboundInvoiceCreateSchema = z
  .object({
    ...outboundInvoiceCreateSchema.shape,
    items: mcpLineItems.describe(
      "Line items. At least one, capped at 50. Each line uses `unit_price`.",
    ),
  })
  .superRefine(refineOutboundInvoicePayments);

export const mcpOutboundInvoiceDraftPatchSchema = z.object({
  ...outboundInvoiceDraftPatchSchema.shape,
  items: mcpLineItems
    .describe(
      "Replacement line items. Replaces the entire list. Each line uses `unit_price`.",
    )
    .optional(),
});

type McpLineInput = {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
};

/** Persist MCP lines with the stored camelCase key. */
export function lineItemsForStorage(items: McpLineInput[]) {
  return items.map(({ unit_price, ...rest }) => ({
    ...rest,
    unitPrice: unit_price,
  }));
}

type StoredLine = {
  unitPrice?: number;
  unit_price?: number;
  [key: string]: unknown;
};

/** MCP responses use `unit_price`. The stored key is not returned. */
export function toMcpOutboundInvoice<T>(payload: T): T {
  if (payload == null || typeof payload !== "object" || !("items" in payload)) {
    return payload;
  }
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return payload;
  return {
    ...payload,
    items: items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const { unitPrice, ...rest } = item as StoredLine;
      return {
        ...rest,
        unit_price: unitPrice ?? rest.unit_price,
      };
    }),
  };
}
