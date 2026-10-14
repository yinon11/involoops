import { db } from "@/db";
import { auditLog, invoices, periods, vendors } from "@/db/schema";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/errors";
import type { ParsedCursor } from "@/lib/api/pagination";
import { sanitizePostgresText } from "@/lib/utils";
import { mintExpenseFileUrl } from "@/lib/invoices/file-link";

const STATUSES = ["processing", "pending", "approved", "rejected"] as const;
type InvoiceStatus = (typeof STATUSES)[number];

export function parseInvoiceStatus(value: string | null): InvoiceStatus | null {
  if (!value) return null;
  return (STATUSES as readonly string[]).includes(value)
    ? (value as InvoiceStatus)
    : null;
}

type InvoiceRow = typeof invoices.$inferSelect;

export interface ExpenseRecord {
  object: "invoice";
  id: string;
  status: string;
  vendor_id: string | null;
  vendor_name: string | null;
  suggested_vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  amount: string;
  currency: string | null;
  vat_amount: string | null;
  amount_without_vat: string | null;
  description: string | null;
  extraction_confidence: string | null;
  rejection_reason: string | null;
  file_name: string | null;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
}

function serialize(
  row: InvoiceRow,
  vendorName: string | null,
  withPreview: boolean,
): ExpenseRecord {
  const preview = withPreview
    ? mintExpenseFileUrl({ userId: row.userId, invoiceId: row.id })
    : null;
  return {
    object: "invoice",
    id: row.id,
    status: row.status ?? "pending",
    vendor_id: row.vendorId,
    vendor_name: vendorName,
    suggested_vendor_name: row.suggestedVendorName,
    invoice_number: row.invoiceNumber,
    invoice_date: row.invoiceDate,
    amount: row.amount,
    currency: row.currency,
    vat_amount: row.vatAmount,
    amount_without_vat: row.amountWithoutVat,
    description: row.description,
    extraction_confidence: row.extractionConfidence,
    rejection_reason: row.rejectionReason,
    file_name: row.fileName,
    preview_url: preview?.url ?? null,
    created_at: (row.createdAt ?? new Date()).toISOString(),
    updated_at: (row.updatedAt ?? row.createdAt ?? new Date()).toISOString(),
  };
}

async function loadOwned(userId: string, id: string) {
  const row = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), eq(invoices.userId, userId)),
  });
  return row ?? null;
}

async function vendorNameFor(userId: string, vendorId: string | null) {
  if (!vendorId) return null;
  const vendor = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, vendorId), eq(vendors.userId, userId)),
    columns: { name: true },
  });
  return vendor?.name ?? null;
}

export async function listExpensesForApi(input: {
  userId: string;
  status: InvoiceStatus | null;
  limit: number;
  cursor: ParsedCursor | null;
}): Promise<Array<ExpenseRecord & { id: string }>> {
  const filters = [eq(invoices.userId, input.userId)];
  if (input.status) filters.push(eq(invoices.status, input.status));
  if (input.cursor) {
    const cursorDate = new Date(input.cursor.k);
    if (!isNaN(cursorDate.getTime())) {
      filters.push(
        or(
          lt(invoices.createdAt, cursorDate),
          and(eq(invoices.createdAt, cursorDate), lt(invoices.id, input.cursor.id)),
        )!,
      );
    }
  }
  const rows = await db
    .select({
      invoice: invoices,
      vendorName: vendors.name,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, input.userId)),
    )
    .where(and(...filters))
    .orderBy(desc(invoices.createdAt), desc(invoices.id))
    .limit(input.limit + 1);
  return rows.map((row) => serialize(row.invoice, row.vendorName, false));
}

export async function getExpenseForApi(userId: string, id: string) {
  const row = await loadOwned(userId, id);
  if (!row) return null;
  const name = await vendorNameFor(userId, row.vendorId);
  return serialize(row, name, true);
}

export async function patchExpenseForApi(
  userId: string,
  id: string,
  patch: {
    vendor_name?: string;
    invoice_number?: string | null;
    invoice_date?: string;
    amount?: string;
    currency?: string;
    vat_amount?: string | null;
    amount_without_vat?: string | null;
    description?: string | null;
  },
) {
  const row = await loadOwned(userId, id);
  if (!row) {
    throw new ApiError({ code: "not_found", status: 404, title: "Invoice not found" });
  }
  if (row.status !== "pending") {
    throw new ApiError({
      code: "document_immutable",
      status: 409,
      title: "Only a pending invoice can be corrected here",
    });
  }

  const update: Partial<typeof invoices.$inferInsert> = { updatedAt: new Date() };
  if (patch.invoice_number !== undefined) {
    update.invoiceNumber = blankToNull(patch.invoice_number);
  }
  if (patch.invoice_date !== undefined) update.invoiceDate = patch.invoice_date;
  if (patch.amount !== undefined) update.amount = patch.amount;
  if (patch.currency !== undefined) update.currency = patch.currency;
  if (patch.vat_amount !== undefined) update.vatAmount = blankToNull(patch.vat_amount);
  if (patch.amount_without_vat !== undefined) {
    update.amountWithoutVat = blankToNull(patch.amount_without_vat);
  }
  if (patch.description !== undefined) update.description = blankToNull(patch.description);

  if (patch.vendor_name !== undefined) {
    const name = sanitizePostgresText(patch.vendor_name)?.trim() ?? "";
    if (name) {
      const vendorId = await findOrCreateVendor(userId, name);
      update.vendorId = vendorId;
      update.suggestedVendorName = null;
    }
  }

  await db
    .update(invoices)
    .set(update)
    .where(and(eq(invoices.id, id), eq(invoices.userId, userId)));
  await db.insert(auditLog).values({
    userId,
    invoiceId: id,
    action: "update",
    details: { updatedFields: Object.keys(patch), via: "api" },
  });
  return getExpenseForApi(userId, id);
}

export async function approveExpenseForApi(
  userId: string,
  id: string,
  vendorName: string | undefined,
) {
  const row = await loadOwned(userId, id);
  if (!row) {
    throw new ApiError({ code: "not_found", status: 404, title: "Invoice not found" });
  }
  if (row.status !== "pending") {
    throw new ApiError({
      code: "conflict",
      status: 409,
      title: "Only a pending invoice can be approved",
    });
  }

  let vendorId = row.vendorId;
  if (!vendorId) {
    const name =
      sanitizePostgresText(vendorName)?.trim() ||
      sanitizePostgresText(row.suggestedVendorName)?.trim() ||
      "";
    if (!name) {
      throw new ApiError({
        code: "validation_failed",
        status: 422,
        title: "Link a vendor before approving",
      });
    }
    vendorId = await findOrCreateVendor(userId, name);
  }

  const invoiceDate = row.invoiceDate ?? new Date().toISOString().slice(0, 10);
  const [yearStr, monthStr] = invoiceDate.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (Number.isFinite(year) && Number.isFinite(month)) {
    const period = await db.query.periods.findFirst({
      where: and(
        eq(periods.userId, userId),
        eq(periods.year, year),
        eq(periods.month, month),
      ),
    });
    if (period?.isLocked) {
      const label = `${year}-${String(month).padStart(2, "0")}`;
      throw new ApiError({
        code: "period_locked",
        status: 409,
        title: `Period ${label} is locked`,
      });
    }
  }

  await db
    .update(invoices)
    .set({
      status: "approved",
      vendorId,
      suggestedVendorName: null,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, id), eq(invoices.userId, userId)));
  await db.insert(auditLog).values({
    userId,
    invoiceId: id,
    action: "approve",
    details: { via: "api" },
  });
  return getExpenseForApi(userId, id);
}

export async function rejectExpenseForApi(userId: string, id: string, reason: string) {
  const row = await loadOwned(userId, id);
  if (!row) {
    throw new ApiError({ code: "not_found", status: 404, title: "Invoice not found" });
  }
  if (row.status !== "pending" && row.status !== "processing") {
    throw new ApiError({
      code: "conflict",
      status: 409,
      title: "Only a pending invoice can be rejected",
    });
  }
  await db
    .update(invoices)
    .set({
      status: "rejected",
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, id), eq(invoices.userId, userId)));
  await db.insert(auditLog).values({
    userId,
    invoiceId: id,
    action: "reject",
    details: { reason, via: "api" },
  });
  return getExpenseForApi(userId, id);
}

function blankToNull(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function findOrCreateVendor(userId: string, name: string): Promise<string> {
  const found = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(
        eq(vendors.userId, userId),
        sql`(
          lower(${vendors.name}) = lower(${name})
          OR EXISTS (
            SELECT 1
            FROM unnest(coalesce(${vendors.aliases}, ARRAY[]::text[])) AS a(val)
            WHERE lower(a.val) = lower(${name})
          )
        )`,
      ),
    )
    .limit(1);
  if (found[0]) return found[0].id;
  try {
    const [created] = await db
      .insert(vendors)
      .values({ userId, name, aliases: [] })
      .returning({ id: vendors.id });
    if (!created) {
      throw new ApiError({
        code: "internal_error",
        status: 500,
        title: "Could not create vendor",
      });
    }
    return created.id;
  } catch (err) {
    const again = await db.query.vendors.findFirst({
      where: and(eq(vendors.userId, userId), eq(vendors.name, name)),
      columns: { id: true },
    });
    if (again) return again.id;
    throw err;
  }
}
