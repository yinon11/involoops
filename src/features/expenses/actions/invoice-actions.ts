"use server";

import { db } from "@/db";
import {
  invoices,
  vendors,
  periods,
  auditLog,
  extractionRules,
  users,
} from "@/db/schema";
import { auth } from "@/auth";
import {
  createVendor,
  findVendorByNameOrAlias,
  getVendors,
} from "@/features/expenses/actions/vendor-actions";
import {
  eq,
  and,
  or,
  gt,
  sql,
  desc,
  gte,
  lte,
  like,
  inArray,
  count,
  isNull,
  isNotNull,
} from "drizzle-orm";
import { normalizeForVendorMatch } from "@/lib/extraction/vendor-matcher";
import { revalidatePath } from "next/cache";
import { processInvoice } from "@/lib/extraction/pipeline";
import { resolveAnthropicApiKey } from "@/lib/user-api-key";
import { deleteFile, downloadFile } from "@/lib/storage";
import { resolveStorageKeyFromFileUrl } from "@/lib/storage-key";
import { sendInvoiceEmail } from "@/lib/email/send-invoice-email";
import { getAdminEmail, warnNoAdminEmail } from "@/lib/email/transactional";
import { getRecentServerLogs, type ServerLogEntry } from "@/lib/server-logs";
import { sanitizePostgresText } from "@/lib/utils";
import { checkUsageLimit, tryReserveInvoiceSlot } from "@/lib/usage";
import type { VendorRule } from "@/types/vendor";
import { sqlAmountInDisplayCurrency } from "@/lib/fx";
import { getUserDisplayCurrency } from "@/lib/display-currency";
import { sumIssuedIncome } from "@/lib/outbound/revenue";
import {
  incomeCoveredByIssuedDocument,
  mirrorIssuedIncomeForUser,
} from "@/lib/outbound/income-mirror";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import type { ActionResultWith } from "@/types/action-result";
import { requireActorUserId as requireUserId } from "@/lib/team/enforce";
import { getDictionary } from "@/lib/i18n/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Discriminated-union return shape for server actions that can fail with a
 * user-facing validation message.
 *
 * Why not just `throw new Error("...")`?
 *   In Next.js production builds, errors thrown from server actions have
 *   their `.message` REDACTED before reaching the client (replaced with the
 *   generic "An error occurred in the Server Components render…" string +
 *   a `digest`). The client `catch` therefore can't display the real text.
 *   Returning a structured result preserves the message across the wire.
 *
 * Use this for **validation** errors the user can act on (missing date,
 * locked period, missing vendor link). Continue to `throw` for auth /
 * integrity errors that should never happen in a normal flow ("Invoice
 * not found", "Unauthorized") — those legitimately become 500s.
 *
 * Convention on the client: `if (!result.success) throw new Error(result.error);`
 * — re-throwing client-side preserves the message because no redaction
 * happens within the browser.
 */
export type ActionResult = { success: true } | { success: false; error: string };

/**
 * Load the user's preferred dashboard display currency (or env/ILS fallback).
 * Returns an ISO 4217 uppercase code known to the FX layer.
 */
function getDisplayCurrencyForUser(userId: string): Promise<string> {
  return getUserDisplayCurrency(userId);
}

function toYearMonth(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Period locking uses the invoice document date, not upload month (`addedMonth`). */
function yearMonthFromInvoiceDateField(
  invoiceDate: string | Date | null | undefined
): { year: number; month: number } | null {
  if (invoiceDate == null) return null;
  const d =
    typeof invoiceDate === "string" || typeof invoiceDate === "number"
      ? new Date(invoiceDate)
      : invoiceDate;
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface InvoiceFilters {
  status?: "processing" | "pending" | "approved" | "rejected";
  vendorId?: string;
  /** When set, restricts to any of these vendors (multi-select). */
  vendorIds?: string[];
  type?: "expense" | "income";
  year?: number;
  month?: number;
  /** When set, restricts to any of these months (multi-select). Takes precedence over `month`. */
  months?: number[];
  dateFrom?: string; // ISO date string
  dateTo?: string;
  search?: string;
  limit?: number;
  offset?: number;
  /** Pending queue: only invoices with no linked vendor (`vendor_id` IS NULL). */
  unlinkedVendorOnly?: boolean;
  /**
   * Leave out income rows copied from documents this business issued.
   * The uploaded-income and profit totals already add those through
   * `sumIssuedIncome`; counting the copies as well would book the sale twice.
   */
  excludeIssuedMirrors?: boolean;
}

function buildInvoiceFilterConditions(
  userId: string,
  filters: InvoiceFilters,
): ReturnType<typeof eq>[] {
  const { limit: _l, offset: _o, ...f } = filters;
  const conditions: ReturnType<typeof eq>[] = [eq(invoices.userId, userId)];

  if (f.status) {
    conditions.push(eq(invoices.status, f.status));
  }
  if (f.unlinkedVendorOnly) {
    conditions.push(isNull(invoices.vendorId));
  } else if (f.vendorIds && f.vendorIds.length > 0) {
    conditions.push(inArray(invoices.vendorId, f.vendorIds));
  } else if (f.vendorId) {
    conditions.push(eq(invoices.vendorId, f.vendorId));
  }
  if (f.type) {
    conditions.push(eq(invoices.type, f.type));
  }
  if (f.year) {
    conditions.push(
      sql`extract(year from ${invoices.invoiceDate}::date) = ${f.year}`,
    );
  }
  if (f.months && f.months.length > 0) {
    conditions.push(
      inArray(
        sql<number>`extract(month from ${invoices.invoiceDate}::date)::int`,
        f.months,
      ),
    );
  } else if (f.month) {
    conditions.push(
      sql`extract(month from ${invoices.invoiceDate}::date) = ${f.month}`,
    );
  }
  if (f.dateFrom) {
    conditions.push(gte(invoices.invoiceDate, f.dateFrom));
  }
  if (f.dateTo) {
    conditions.push(lte(invoices.invoiceDate, f.dateTo));
  }
  if (f.search) {
    conditions.push(like(invoices.invoiceNumber, `%${f.search}%`));
  }
  if (f.excludeIssuedMirrors) {
    conditions.push(isNull(invoices.outboundInvoiceId));
  }

  return conditions;
}

// ---------------------------------------------------------------------------
// getInvoices
// ---------------------------------------------------------------------------

export async function getInvoices(filters: InvoiceFilters = {}) {
  const userId = await requireUserId("view_invoices");
  // Issued documents are not stored as invoices until this runs, so the
  // Income filter on this page shows them as approved income.
  await mirrorIssuedIncomeForUser(userId);
  const { limit, offset } = filters;
  const conditions = buildInvoiceFilterConditions(userId, filters);

  const q = db
    .select({
      id: invoices.id,
      userId: invoices.userId,
      vendorId: invoices.vendorId,
      suggestedVendorName: invoices.suggestedVendorName,
      type: invoices.type,
      status: invoices.status,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      amount: invoices.amount,
      currency: invoices.currency,
      vatAmount: invoices.vatAmount,
      amountWithoutVat: invoices.amountWithoutVat,
      description: invoices.description,
      expenseCategory: invoices.expenseCategory,
      isFixedAsset: invoices.isFixedAsset,
      fixedAssetSynced: invoices.fixedAssetSynced,
      fileUrl: invoices.fileUrl,
      fileName: invoices.fileName,
      pageCount: invoices.pageCount,
      rejectionReason: invoices.rejectionReason,
      addedMonth: invoices.addedMonth,
      sentToAccountantAt: invoices.sentToAccountantAt,
      extractionMethod: invoices.extractionMethod,
      extractionConfidence: invoices.extractionConfidence,
      createdAt: invoices.createdAt,
      updatedAt: invoices.updatedAt,
      vendorName: vendors.name,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
    )
    .where(and(...conditions))
    .orderBy(desc(invoices.createdAt), desc(invoices.id));

  if (limit != null) {
    return await q.limit(limit).offset(offset ?? 0);
  }

  return await q;
}

// ---------------------------------------------------------------------------
// getInvoiceCount
// ---------------------------------------------------------------------------

/** Row count for the same filters as {@link getInvoices} (ignores limit/offset). */
export async function getInvoiceCount(filters: InvoiceFilters = {}) {
  const userId = await requireUserId("view_invoices");
  const conditions = buildInvoiceFilterConditions(userId, filters);

  const [row] = await db
    .select({ count: count(invoices.id) })
    .from(invoices)
    .where(and(...conditions));

  return row?.count ?? 0;
}

/**
 * 1-based page index for a pending invoice in the pending queue ordering
 * (newest first, then id descending). Returns null if the invoice is missing
 * or not pending. When `vendorId` is set, the invoice must belong to that
 * vendor and ranking is within that slice only. When `unlinkedVendorOnly`,
 * only invoices with no linked vendor are considered (`vendorId` is ignored).
 */
export async function getPendingInvoiceOneBasedPage(
  invoiceId: string,
  pageSize: number,
  vendorId?: string | null,
  unlinkedVendorOnly?: boolean,
): Promise<number | null> {
  const userId = await requireUserId("view_invoices");
  const sliceCond = unlinkedVendorOnly
    ? isNull(invoices.vendorId)
    : vendorId != null && vendorId.length > 0
      ? eq(invoices.vendorId, vendorId)
      : undefined;

  const inv = await db.query.invoices.findFirst({
    where: and(
      eq(invoices.id, invoiceId),
      eq(invoices.userId, userId),
      eq(invoices.status, "pending"),
      ...(sliceCond ? [sliceCond] : []),
    ),
    columns: { createdAt: true },
  });
  if (!inv?.createdAt) return null;

  const [row] = await db
    .select({ ahead: count(invoices.id) })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        eq(invoices.status, "pending"),
        ...(sliceCond ? [sliceCond] : []),
        or(
          gt(invoices.createdAt, inv.createdAt),
          and(eq(invoices.createdAt, inv.createdAt), gt(invoices.id, invoiceId)),
        ),
      ),
    );

  const ahead = row?.ahead ?? 0;
  return Math.floor(ahead / pageSize) + 1;
}

// ---------------------------------------------------------------------------
// getPendingInvoiceCount
// ---------------------------------------------------------------------------

export async function getPendingInvoiceCount(): Promise<number> {
  const { hasCap } = await import("@/lib/team/enforce");
  if (!(await hasCap("view_invoices"))) return 0;
  const userId = await requireUserId();

  const [row] = await db
    .select({ count: count(invoices.id) })
    .from(invoices)
    .where(
      and(eq(invoices.userId, userId), eq(invoices.status, "pending")),
    );

  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// getInvoiceById
// ---------------------------------------------------------------------------

export async function getInvoiceById(id: string) {
  const userId = await requireUserId("view_invoices");

  const rows = await db
    .select({
      id: invoices.id,
      userId: invoices.userId,
      vendorId: invoices.vendorId,
      suggestedVendorName: invoices.suggestedVendorName,
      type: invoices.type,
      status: invoices.status,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      amount: invoices.amount,
      currency: invoices.currency,
      vatAmount: invoices.vatAmount,
      amountWithoutVat: invoices.amountWithoutVat,
      description: invoices.description,
      expenseCategory: invoices.expenseCategory,
      isFixedAsset: invoices.isFixedAsset,
      fixedAssetSynced: invoices.fixedAssetSynced,
      fileUrl: invoices.fileUrl,
      fileName: invoices.fileName,
      fileHash: invoices.fileHash,
      extractedText: invoices.extractedText,
      extractionMethod: invoices.extractionMethod,
      extractionConfidence: invoices.extractionConfidence,
      rejectionReason: invoices.rejectionReason,
      addedMonth: invoices.addedMonth,
      sentToAccountantAt: invoices.sentToAccountantAt,
      createdAt: invoices.createdAt,
      updatedAt: invoices.updatedAt,
      vendorName: vendors.name,
      vendorCategory: vendors.defaultCategory,
      vendorIsIncomeSource: vendors.isIncomeSource,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
    )
    .where(and(eq(invoices.id, id), eq(invoices.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// approveInvoice
// ---------------------------------------------------------------------------

export async function approveInvoice(id: string): Promise<ActionResult> {
  const dict = await getDictionary();
  const userId = await requireUserId("manage_invoices");

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), eq(invoices.userId, userId)),
  });

  if (!invoice) {
    throw new Error("Invoice not found");
  }

  // Returned (not thrown) so the message survives Next.js production
  // server-action redaction; see the ActionResult comment block above.
  if (!invoice.vendorId && invoice.suggestedVendorName?.trim()) {
    return {
      success: false,
      error: dict.errors.linkVendorBeforeApprove,
    };
  }

  const invoiceDate = invoice.invoiceDate
    ? new Date(invoice.invoiceDate)
    : new Date();
  const invoiceMonthLabel = toYearMonth(invoiceDate);
  const year = invoiceDate.getFullYear();
  const month = invoiceDate.getMonth() + 1;

  // Check if period is locked (by invoice document month, not upload month)
  const period = await db.query.periods.findFirst({
    where: and(
      eq(periods.userId, userId),
      eq(periods.year, year),
      eq(periods.month, month)
    ),
  });

  if (period?.isLocked) {
    return {
      success: false,
      error: `Period ${invoiceMonthLabel} is locked. Unlock it before approving invoices.`,
    };
  }

  await db
    .update(invoices)
    .set({
      status: "approved",
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, id), eq(invoices.userId, userId)));

  await db.insert(auditLog).values({
    userId,
    invoiceId: id,
    action: "approve",
    details: { invoiceMonth: invoiceMonthLabel },
  });

  revalidatePath("/invoices");
  revalidatePath("/pending");
  revalidatePath("/dashboard");
  revalidatePath(`/invoices/${id}`);

  return { success: true };
}

/**
 * Create a vendor from the given name, link the invoice, then approve.
 * Used from invoices list / dashboard when the invoice has suggestedVendorName but no vendorId.
 */
export async function approveInvoiceAndCreateVendor(
  invoiceId: string,
  vendorName: string
): Promise<ActionResult> {
  const dict = await getDictionary();
  const userId = await requireUserId("manage_invoices");

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)),
  });

  if (!invoice) {
    throw new Error("Invoice not found");
  }

  const name = sanitizePostgresText(vendorName.trim());
  if (!name) {
    return { success: false, error: dict.errors.vendorNameRequired };
  }

  if (invoice.vendorId) {
    return approveInvoice(invoiceId);
  }

  // Reuse an existing vendor when the name matches its name OR any alias.
  const existing = await findVendorByNameOrAlias(name);
  const vendorId = existing?.id ?? (await createVendor({ name })).id;
  const linkResult = await updateInvoice(invoiceId, {
    vendorId,
    suggestedVendorName: null,
  });
  if (!linkResult.success) return linkResult;

  return approveInvoice(invoiceId);
}

// ---------------------------------------------------------------------------
// rejectInvoice
// ---------------------------------------------------------------------------

export async function rejectInvoice(id: string, reason: string) {
  const userId = await requireUserId("manage_invoices");

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), eq(invoices.userId, userId)),
  });

  if (!invoice) {
    throw new Error("Invoice not found");
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
    details: { reason },
  });

  revalidatePath("/invoices");
  revalidatePath("/pending");
  revalidatePath("/dashboard");
  revalidatePath(`/invoices/${id}`);

  return { success: true };
}

// ---------------------------------------------------------------------------
// setInvoicePending — move approved/rejected back to pending (invoices list)
// ---------------------------------------------------------------------------

export async function setInvoicePending(id: string): Promise<ActionResult> {
  const dict = await getDictionary();
  const userId = await requireUserId("manage_invoices");

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), eq(invoices.userId, userId)),
  });

  if (!invoice) {
    throw new Error("Invoice not found");
  }
  if (invoice.status === "processing") {
    return { success: false, error: dict.errors.invoiceStillProcessing };
  }
  if (invoice.status === "pending") {
    return { success: true };
  }

  if (invoice.status === "approved") {
    let ym = yearMonthFromInvoiceDateField(invoice.invoiceDate);
    if (!ym && invoice.addedMonth) {
      const [yearStr, monthStr] = invoice.addedMonth.split("-");
      const y = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10);
      if (Number.isFinite(y) && Number.isFinite(m)) ym = { year: y, month: m };
    }
    if (ym) {
      const period = await db.query.periods.findFirst({
        where: and(
          eq(periods.userId, userId),
          eq(periods.year, ym.year),
          eq(periods.month, ym.month)
        ),
      });
      if (period?.isLocked) {
        const label = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
        return {
          success: false,
          error: `Period ${label} is locked. Unlock it before moving this invoice back to pending.`,
        };
      }
    }
  }

  await db
    .update(invoices)
    .set({
      status: "pending",
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, id), eq(invoices.userId, userId)));

  await db.insert(auditLog).values({
    userId,
    invoiceId: id,
    action: "set_pending",
    details: {},
  });

  revalidatePath("/invoices");
  revalidatePath("/pending");
  revalidatePath("/dashboard");
  revalidatePath(`/invoices/${id}`);

  return { success: true as const };
}

/**
 * When a vendor is linked on one invoice, other pending invoices with the same
 * suggested label (extracted name) get linked too and `suggestedVendorName` is cleared.
 */
async function syncPendingInvoicesForLinkedVendor(
  userId: string,
  vendorId: string
): Promise<number> {
  const vendor = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, vendorId), eq(vendors.userId, userId)),
  });
  if (!vendor) return 0;

  const labels = [vendor.name, ...((vendor.aliases ?? []) as string[])]
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (labels.length === 0) return 0;

  const pending = await db.query.invoices.findMany({
    where: and(
      eq(invoices.userId, userId),
      eq(invoices.status, "pending"),
      isNull(invoices.vendorId)
    ),
  });

  let updated = 0;
  for (const inv of pending) {
    const s = inv.suggestedVendorName?.trim();
    if (!s) continue;
    if (!suggestedMatchesVendorLabels(s, labels)) continue;

    await db
      .update(invoices)
      .set({
        vendorId,
        suggestedVendorName: null,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));
    updated++;
  }

  if (updated > 0) {
    revalidatePath("/pending");
    revalidatePath("/invoices");
    revalidatePath("/dashboard");
  }

  return updated;
}

function suggestedMatchesVendorLabels(
  suggested: string,
  labels: string[]
): boolean {
  const normS = normalizeForVendorMatch(suggested);
  if (normS.length < 2) return false;
  for (const label of labels) {
    const normL = normalizeForVendorMatch(label);
    if (normL.length < 2) continue;
    if (normS === normL) return true;
    const shorter = normS.length <= normL.length ? normS : normL;
    const longer = normS.length > normL.length ? normS : normL;
    if (shorter.length >= 6 && longer.includes(shorter)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// updateInvoice
// ---------------------------------------------------------------------------

export async function updateInvoice(
  id: string,
  data: Partial<{
    vendorId: string | null;
    /**
     * Convenience: caller passes the vendor label from a form input and the
     * action resolves it to a `vendorId` via find-or-create. Intended for the
     * pending review card's Vendor input — editing that field now re-links
     * the invoice to a vendor with the given name instead of being silently
     * discarded.
     */
    vendorName: string;
    suggestedVendorName: string | null;
    type: "expense" | "income";
    invoiceNumber: string;
    invoiceDate: string;
    amount: string;
    currency: string;
    vatAmount: string;
    amountWithoutVat: string;
    description: string;
  }>
): Promise<ActionResult> {
  const dict = await getDictionary();
  const userId = await requireUserId("manage_invoices");

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), eq(invoices.userId, userId)),
  });

  if (!invoice) {
    throw new Error("Invoice not found");
  }

  // If approved, lock check uses invoice document month (not `addedMonth`, which is upload month).
  if (invoice.status === "approved") {
    let ym = yearMonthFromInvoiceDateField(invoice.invoiceDate);
    if (!ym && invoice.addedMonth) {
      const [yearStr, monthStr] = invoice.addedMonth.split("-");
      const y = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10);
      if (Number.isFinite(y) && Number.isFinite(m)) ym = { year: y, month: m };
    }
    if (ym) {
      const period = await db.query.periods.findFirst({
        where: and(
          eq(periods.userId, userId),
          eq(periods.year, ym.year),
          eq(periods.month, ym.month)
        ),
      });

      if (period?.isLocked) {
        const label = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
        return {
          success: false,
          error: `Period ${label} is locked. Cannot update this invoice.`,
        };
      }
    }
  }

  // Resolve `vendorName` (if provided) to a `vendorId` via find-or-create.
  // When the caller also provides an explicit `vendorId`, that wins — the
  // name is used only to derive a link.
  const { vendorName, ...rest } = data;
  const updatePayload: Record<string, unknown> = { ...rest };

  if (vendorName !== undefined && updatePayload.vendorId === undefined) {
    const trimmed = sanitizePostgresText(vendorName.trim()) ?? "";

    if (trimmed.length > 0) {
      // If the already-linked vendor matches, don't touch vendorId.
      let currentName: string | null = null;
      if (invoice.vendorId) {
        const currentVendor = await db.query.vendors.findFirst({
          where: and(
            eq(vendors.id, invoice.vendorId),
            eq(vendors.userId, userId)
          ),
        });
        currentName = currentVendor?.name ?? null;
      }

      if (currentName !== trimmed) {
        const existing = await db.query.vendors.findFirst({
          where: and(eq(vendors.userId, userId), eq(vendors.name, trimmed)),
        });

        if (existing) {
          updatePayload.vendorId = existing.id;
        } else {
          const created = await createVendor({ name: trimmed });
          updatePayload.vendorId = created.id;
        }

        // A real vendor is now linked — clear any stale suggestion.
        if (updatePayload.suggestedVendorName === undefined) {
          updatePayload.suggestedVendorName = null;
        }
      }
    }
  }

  // Normalize empty strings from the form before hitting the DB. Postgres
  // rejects "" for numeric columns, and an empty invoice_number /
  // vat_amount is semantically "unknown", not the literal empty string.
  // The form always sends a string value for these fields, so we coerce
  // blanks to null here rather than scatter trims across every caller.
  for (const key of [
    "invoiceNumber",
    "vatAmount",
    "amountWithoutVat",
    "description",
  ] as const) {
    if (typeof updatePayload[key] === "string" && updatePayload[key].trim() === "") {
      updatePayload[key] = null;
    }
  }

  // Invoice date is required for a saveable record. Without it, the row
  // can't be placed on a monthly timeline (dashboard, period locks, etc.),
  // so refuse the update with a user-facing error the ReviewCard can
  // surface in its feedback area — instead of a cryptic Postgres
  // "invalid input syntax for type date" crash.
  // Returned (not thrown) so the message survives Next.js production
  // server-action redaction; see the ActionResult comment block above.
  if (
    "invoiceDate" in updatePayload &&
    (updatePayload.invoiceDate == null ||
      (typeof updatePayload.invoiceDate === "string" &&
        updatePayload.invoiceDate.trim() === ""))
  ) {
    return {
      success: false,
      error: dict.errors.invoiceDateRequired,
    };
  }

  await db
    .update(invoices)
    .set({
      ...updatePayload,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, id), eq(invoices.userId, userId)));

  await db.insert(auditLog).values({
    userId,
    invoiceId: id,
    action: "update",
    details: { updatedFields: Object.keys(data) },
  });

  if (
    typeof updatePayload.vendorId === "string" &&
    updatePayload.vendorId.length > 0
  ) {
    await syncPendingInvoicesForLinkedVendor(userId, updatePayload.vendorId);
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// reExtractInvoice — re-run Claude / PDF extraction, set status to pending
// ---------------------------------------------------------------------------

export async function reExtractInvoice(
  invoiceId: string
): Promise<ActionResult> {
  const userId = await requireUserId("manage_invoices");

  const row = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)),
  });

  if (!row) {
    throw new Error("Invoice not found");
  }
  if (!row.fileUrl?.trim()) {
    throw new Error("No file attached to this invoice");
  }

  const key = resolveStorageKeyFromFileUrl(row.fileUrl);
  if (!key) {
    throw new Error("Could not resolve storage key for this file");
  }

  // Re-extraction re-runs the full LLM pipeline and costs tokens just like
  // an initial upload, so it must reserve a slot atomically before doing
  // any work. If the user is at the monthly cap, refuse — the slot stays
  // consumed for every successful reservation (monotonic counter), and we
  // don't want to charge them for work we then refused to do.
  const usage = await checkUsageLimit(userId);
  const reserved = await tryReserveInvoiceSlot(userId, usage.limit);
  if (!reserved) {
    return {
      success: false,
      error: `Monthly invoice limit reached (${usage.current}/${usage.limit} on ${usage.planName}). Upgrade your plan to re-extract this invoice.`,
    };
  }

  const fileBuffer = await downloadFile(key);

  const userVendors = await db.query.vendors.findMany({
    where: eq(vendors.userId, userId),
  });

  const vendorInfos = userVendors.map((v) => ({
    id: v.id,
    name: v.name,
    aliases: (v.aliases ?? []) as string[],
    isIncomeSource: v.isIncomeSource ?? false,
  }));

  const userRules = await db
    .select()
    .from(extractionRules)
    .where(eq(extractionRules.userId, userId));

  const vendorRules = userRules
    .filter((r) => r.isActive !== false)
    .map((r) => ({
      vendorId: r.vendorId ?? null,
      priority: r.priority ?? 0,
      ...(r.rules as Record<string, unknown>),
    })) as VendorRule[];

  const { key: anthropicApiKey } = await resolveAnthropicApiKey(userId);

  const extraction = await processInvoice(
    fileBuffer,
    userId,
    vendorInfos,
    vendorRules,
    anthropicApiKey
  );

  const vendorId: string | null = extraction.matchedVendorId;
  const suggestedVendorName =
    !vendorId && extraction.data.vendorName?.trim()
      ? sanitizePostgresText(extraction.data.vendorName.trim()) || null
      : null;

  // Derive invoice type from the matched vendor's income flag so that
  // re-extraction respects a vendor that has been reclassified as income.
  const matchedVendor = vendorId
    ? userVendors.find((v) => v.id === vendorId)
    : null;
  const type: "income" | "expense" = matchedVendor?.isIncomeSource
    ? "income"
    : "expense";

  await db
    .update(invoices)
    .set({
      vendorId,
      suggestedVendorName,
      type,
      status: "pending",
      invoiceNumber: sanitizePostgresText(extraction.data.invoiceNumber ?? null),
      invoiceDate: extraction.data.invoiceDate,
      amount: extraction.data.amount?.toString() ?? "0",
      currency: extraction.data.currency ?? "ILS",
      vatAmount: extraction.data.vatAmount?.toString() ?? null,
      amountWithoutVat: extraction.data.amountWithoutVat?.toString() ?? null,
      description: sanitizePostgresText(extraction.data.description),
      pageCount: extraction.pageCount > 0 ? extraction.pageCount : null,
      extractedText: sanitizePostgresText(extraction.rawText),
      extractionMethod: extraction.method,
      extractionConfidence: extraction.confidence.toString(),
      rejectionReason: null,
      llmInputTokens: extraction.llmUsage.inputTokens,
      llmOutputTokens: extraction.llmUsage.outputTokens,
      llmCostUsd: extraction.llmUsage.costUsd.toFixed(6),
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)));

  await db.insert(auditLog).values({
    userId,
    invoiceId,
    action: "re_extract",
    details: { method: extraction.method },
  });

  // The handling slot was already reserved atomically above — no
  // post-hoc increment needed, and the counter never decreases even
  // if the user later deletes this invoice.

  revalidatePath("/invoices");
  revalidatePath("/pending");
  revalidatePath("/dashboard");
  revalidatePath(`/invoices/${invoiceId}`);

  return { success: true as const };
}

// ---------------------------------------------------------------------------
// deleteInvoice
// ---------------------------------------------------------------------------

export async function deleteInvoice(id: string) {
  const userId = await requireUserId("manage_invoices");

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), eq(invoices.userId, userId)),
  });

  if (!invoice) {
    throw new Error("Invoice not found");
  }

  await db.insert(auditLog).values({
    userId,
    invoiceId: id,
    action: "delete",
    details: { invoiceNumber: invoice.invoiceNumber },
  });

  if (invoice.fileUrl?.trim()) {
    const key = resolveStorageKeyFromFileUrl(invoice.fileUrl);
    if (key) {
      await deleteFile(key);
    }
  }

  await db
    .delete(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.userId, userId)));

  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/pending");
  revalidatePath("/duplicates");
  revalidatePath(`/invoices/${id}`);

  return { success: true };
}

// ---------------------------------------------------------------------------
// bulkApprove
// ---------------------------------------------------------------------------

export async function bulkApprove(
  ids: string[]
): Promise<ActionResultWith<{ approved: number; skipped: number }>> {
  const dict = await getDictionary();
  const userId = await requireUserId("manage_invoices");

  if (ids.length === 0)
    return { success: true as const, approved: 0, skipped: 0 };

  const userInvoices = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.userId, userId), inArray(invoices.id, ids)));

  // Gather which periods we need to check (pending invoices only)
  const periodKeys = new Set<string>();
  for (const inv of userInvoices) {
    if (inv.status !== "pending") continue;
    const d = inv.invoiceDate ? new Date(inv.invoiceDate) : new Date();
    periodKeys.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
  }

  // Check locked periods
  const lockedPeriods = new Set<string>();
  for (const key of periodKeys) {
    const [y, m] = key.split("-").map(Number);
    const period = await db.query.periods.findFirst({
      where: and(
        eq(periods.userId, userId),
        eq(periods.year, y),
        eq(periods.month, m)
      ),
    });
    if (period?.isLocked) {
      lockedPeriods.add(key);
    }
  }

  let approved = 0;
  let skipped = 0;

  for (const inv of userInvoices) {
    if (inv.status !== "pending") {
      skipped++;
      continue;
    }

    if (!inv.vendorId && inv.suggestedVendorName?.trim()) {
      return {
        success: false,
        error: dict.errors.bulkNeedsVendor,
      };
    }

    const d = inv.invoiceDate ? new Date(inv.invoiceDate) : new Date();
    const periodKey = `${d.getFullYear()}-${d.getMonth() + 1}`;

    if (lockedPeriods.has(periodKey)) {
      skipped++;
      continue; // skip locked-period invoices
    }

    const invoiceMonthLabel = toYearMonth(d);

    await db
      .update(invoices)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(invoices.id, inv.id));

    await db.insert(auditLog).values({
      userId,
      invoiceId: inv.id,
      action: "approve",
      details: { invoiceMonth: invoiceMonthLabel, bulk: true },
    });

    approved++;
  }

  revalidatePath("/invoices");
  revalidatePath("/pending");
  revalidatePath("/dashboard");
  revalidatePath("/duplicates");

  return { success: true as const, approved, skipped };
}

function revalidateInboundInvoiceSurfaces() {
  revalidatePath("/invoices");
  revalidatePath("/pending");
  revalidatePath("/dashboard");
  revalidatePath("/income");
  revalidatePath("/duplicates");
}

// ---------------------------------------------------------------------------
// Accountant handoff (inbound invoices)
// ---------------------------------------------------------------------------

export async function bulkMarkSentToAccountant(
  ids: string[],
): Promise<ActionResultWith<{ updated: number }>> {
  const userId = await requireUserId("manage_invoices");
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  if (unique.length === 0) {
    return { success: true as const, updated: 0 };
  }

  const candidates = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        inArray(invoices.id, unique),
        isNull(invoices.sentToAccountantAt),
      ),
    );

  if (candidates.length === 0) {
    revalidateInboundInvoiceSurfaces();
    return { success: true as const, updated: 0 };
  }

  const toIds = candidates.map((r) => r.id);
  const now = new Date();
  await db
    .update(invoices)
    .set({ sentToAccountantAt: now, updatedAt: now })
    .where(and(eq(invoices.userId, userId), inArray(invoices.id, toIds)));

  revalidateInboundInvoiceSurfaces();
  return { success: true as const, updated: toIds.length };
}

export async function bulkMarkNotSentToAccountant(
  ids: string[],
): Promise<ActionResultWith<{ updated: number }>> {
  const userId = await requireUserId("manage_invoices");
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  if (unique.length === 0) {
    return { success: true as const, updated: 0 };
  }

  const candidates = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        inArray(invoices.id, unique),
        isNotNull(invoices.sentToAccountantAt),
      ),
    );

  if (candidates.length === 0) {
    revalidateInboundInvoiceSurfaces();
    return { success: true as const, updated: 0 };
  }

  const toIds = candidates.map((r) => r.id);
  const now = new Date();
  await db
    .update(invoices)
    .set({ sentToAccountantAt: null, updatedAt: now })
    .where(and(eq(invoices.userId, userId), inArray(invoices.id, toIds)));

  revalidateInboundInvoiceSurfaces();
  return { success: true as const, updated: toIds.length };
}

export async function setInvoiceSentToAccountant(
  invoiceId: string,
  sent: boolean,
): Promise<ActionResult> {
  const dict = await getDictionary();
  const userId = await requireUserId("manage_invoices");
  const now = new Date();

  const [row] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
    .limit(1);

  if (!row) {
    return { success: false, error: dict.errors.invoiceNotFoundShort };
  }

  await db
    .update(invoices)
    .set({
      sentToAccountantAt: sent ? now : null,
      updatedAt: now,
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)));

  revalidateInboundInvoiceSurfaces();
  revalidatePath(`/invoices/${invoiceId}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// getAuditLog
// ---------------------------------------------------------------------------

export async function getAuditLog(invoiceId: string) {
  const userId = await requireUserId("view_invoices");

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      details: auditLog.details,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(eq(auditLog.invoiceId, invoiceId), eq(auditLog.userId, userId))
    )
    .orderBy(desc(auditLog.createdAt));

  return rows;
}

// ---------------------------------------------------------------------------
// getDashboardStats / getDashboardData
// ---------------------------------------------------------------------------

export type DashboardTimeRange = "allTime" | "last12Months" | "year";

export interface DashboardFilters {
  timeRange?: DashboardTimeRange;
  year?: number;
  months?: number[];
  dateFrom?: string;
  dateTo?: string;
  vendorIds?: string[];
  showWithoutVat?: boolean;
}

/** Matches client `DashboardFilters` in `dashboard-filters.tsx`. */
export interface DashboardClientFilters {
  vendorIds: string[];
  timeRange: DashboardTimeRange;
  year: number | null;
  months: number[];
  dateFrom: string | null;
  dateTo: string | null;
  showWithoutVat: boolean;
}

function dashboardFiltersToServer(
  f: DashboardClientFilters
): DashboardFilters {
  return {
    vendorIds: f.vendorIds.length > 0 ? f.vendorIds : undefined,
    timeRange: f.timeRange,
    year: f.year ?? undefined,
    months: f.months.length > 0 ? f.months : undefined,
    dateFrom: f.dateFrom ?? undefined,
    dateTo: f.dateTo ?? undefined,
    showWithoutVat: f.showWithoutVat,
  };
}

/**
 * Returns the ISO date (YYYY-MM-DD) exactly 12 months before today. Used by
 * the "Last 12 months" dashboard quick filter.
 */
function last12MonthsStartDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d.toISOString().split("T")[0];
}

/**
 * Decide whether the spending trend chart should aggregate by day or month.
 * Periods shorter than two months (~62 days) render as days so a single month
 * or custom short range still shows meaningful variation; longer periods roll
 * up to months to keep the x-axis readable.
 */
function shouldGroupTrendByDay(filters: DashboardFilters): boolean {
  const TWO_MONTHS_DAYS = 62;
  const MS_PER_DAY = 86_400_000;

  // Custom date range from the advanced filter (can combine with quick
  // filters). If both endpoints are present, use their span directly.
  if (filters.dateFrom && filters.dateTo) {
    const span =
      (new Date(filters.dateTo).getTime() -
        new Date(filters.dateFrom).getTime()) /
      MS_PER_DAY;
    return span < TWO_MONTHS_DAYS;
  }
  // Only a start date → measure span against today.
  if (filters.dateFrom) {
    const span =
      (Date.now() - new Date(filters.dateFrom).getTime()) / MS_PER_DAY;
    return span < TWO_MONTHS_DAYS;
  }

  // Year + specific months picked from the month chips. Fewer than 2 months
  // selected means the visible window is at most a single month → days.
  if (filters.year && filters.months && filters.months.length > 0) {
    return filters.months.length < 2;
  }

  // "All times", "Last 12 months", a full year, or a dateTo-only window all
  // span well over two months → keep the monthly buckets.
  return false;
}

function amountSumExpr(showWithoutVat: boolean) {
  return showWithoutVat
    ? sql`coalesce(${invoices.amountWithoutVat}::numeric, ${invoices.amount}::numeric)`
    : sql`${invoices.amount}::numeric`;
}

export async function getDashboardStats(filters: DashboardFilters = {}) {
  const userId = await requireUserId("view_reports");
  const currency = await getDisplayCurrencyForUser(userId);
  const showWithoutVat = filters.showWithoutVat ?? false;
  const amt = amountSumExpr(showWithoutVat);
  const displayAmt = sqlAmountInDisplayCurrency(amt, currency);

  const baseConditions: ReturnType<typeof eq | typeof sql>[] = [
    eq(invoices.userId, userId),
    eq(invoices.status, "approved"),
  ];

  if (filters.timeRange === "last12Months") {
    baseConditions.push(gte(invoices.invoiceDate, last12MonthsStartDate()));
  }
  if (filters.year) {
    baseConditions.push(
      sql`extract(year from ${invoices.invoiceDate}::date) = ${filters.year}`
    );
  }
  if (filters.months && filters.months.length > 0) {
    baseConditions.push(
      inArray(
        sql<number>`extract(month from ${invoices.invoiceDate}::date)::int`,
        filters.months
      )
    );
  }
  if (filters.dateFrom) {
    baseConditions.push(gte(invoices.invoiceDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    baseConditions.push(lte(invoices.invoiceDate, filters.dateTo));
  }
  if (filters.vendorIds && filters.vendorIds.length > 0) {
    baseConditions.push(inArray(invoices.vendorId, filters.vendorIds));
  }

  const expenseConditions = [
    ...baseConditions,
    eq(invoices.type, "expense"),
  ];

  const [totalResult] = await db
    .select({
      totalSpent: sql<string>`coalesce(sum(${displayAmt}), 0)`,
      invoiceCount: count(invoices.id),
    })
    .from(invoices)
    .where(and(...expenseConditions));

  const totalSpent = parseFloat(totalResult.totalSpent);
  const invoiceCount = totalResult.invoiceCount;

  const [vendorCountResult] = await db
    .select({
      vendorCount:
        sql<number>`count(distinct ${invoices.vendorId})`.mapWith(Number),
    })
    .from(invoices)
    .where(and(...expenseConditions));

  const vendorCount = vendorCountResult.vendorCount;

  const groupTrendByDay = shouldGroupTrendByDay(filters);
  const trendGranularity: "day" | "month" = groupTrendByDay ? "day" : "month";
  // Bucket expression reused in select/groupBy/orderBy so the query stays in
  // sync. The format literal is a hard-coded constant, never user input.
  const trendBucketSql = groupTrendByDay
    ? sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM-DD')`
    : sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`;

  const bucketTotals = await db
    .select({
      bucket: trendBucketSql,
      total: sql<string>`sum(${displayAmt})`,
    })
    .from(invoices)
    .where(and(...expenseConditions))
    .groupBy(trendBucketSql)
    .orderBy(trendBucketSql);

  // Monthly average is always computed from monthly rollups, independent of
  // the chart granularity, so the stat card stays stable when users narrow
  // the date range to a single month.
  const monthlyAverageRows = groupTrendByDay
    ? await db
        .select({
          month: sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`,
          total: sql<string>`sum(${displayAmt})`,
        })
        .from(invoices)
        .where(and(...expenseConditions))
        .groupBy(sql`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`)
    : bucketTotals.map((row) => ({ month: row.bucket, total: row.total }));

  const monthlyAverage =
    monthlyAverageRows.length > 0
      ? monthlyAverageRows.reduce((sum, m) => sum + parseFloat(m.total), 0) /
        monthlyAverageRows.length
      : 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

  const burnConditions = [
    eq(invoices.userId, userId),
    eq(invoices.status, "approved"),
    eq(invoices.type, "expense"),
    gte(invoices.invoiceDate, thirtyDaysAgoStr),
  ];
  if (filters.vendorIds && filters.vendorIds.length > 0) {
    burnConditions.push(inArray(invoices.vendorId, filters.vendorIds));
  }

  const [burnResult] = await db
    .select({
      total: sql<string>`coalesce(sum(${displayAmt}), 0)`,
    })
    .from(invoices)
    .where(and(...burnConditions));

  const thirtyDayBurnRate = parseFloat(burnResult.total);

  const trendBuckets = bucketTotals.map((row) => ({
    bucket: row.bucket,
    total: parseFloat(row.total),
  }));

  const vendorBreakdownRows = await db
    .select({
      vendorId: invoices.vendorId,
      vendorName: sql<string>`coalesce(${vendors.name}, 'Unknown')`,
      total: sql<string>`sum(${displayAmt})`,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
    )
    .where(and(...expenseConditions))
    .groupBy(invoices.vendorId, vendors.name)
    .orderBy(sql`sum(${displayAmt}) desc`);

  const vendorBreakdown = vendorBreakdownRows.map((row) => ({
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    total: parseFloat(row.total),
  }));

  // LLM cost aggregation — includes all invoices (not just approved expenses)
  // since LLM cost is incurred regardless of invoice status.
  const llmConditions: ReturnType<typeof eq | typeof sql>[] = [
    eq(invoices.userId, userId),
  ];
  if (filters.timeRange === "last12Months") {
    llmConditions.push(gte(invoices.invoiceDate, last12MonthsStartDate()));
  }
  if (filters.year) {
    llmConditions.push(
      sql`extract(year from ${invoices.invoiceDate}::date) = ${filters.year}`
    );
  }
  if (filters.months && filters.months.length > 0) {
    llmConditions.push(
      inArray(
        sql<number>`extract(month from ${invoices.invoiceDate}::date)::int`,
        filters.months
      )
    );
  }
  if (filters.dateFrom) {
    llmConditions.push(gte(invoices.invoiceDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    llmConditions.push(lte(invoices.invoiceDate, filters.dateTo));
  }
  if (filters.vendorIds && filters.vendorIds.length > 0) {
    llmConditions.push(inArray(invoices.vendorId, filters.vendorIds));
  }

  const [llmResult] = await db
    .select({
      totalCost: sql<string>`coalesce(sum(${invoices.llmCostUsd}::numeric), 0)`,
      totalInputTokens: sql<number>`coalesce(sum(${invoices.llmInputTokens}), 0)`.mapWith(Number),
      totalOutputTokens: sql<number>`coalesce(sum(${invoices.llmOutputTokens}), 0)`.mapWith(Number),
    })
    .from(invoices)
    .where(and(...llmConditions));

  const llmTotalCostUsd = parseFloat(llmResult.totalCost);
  const llmTotalTokens = llmResult.totalInputTokens + llmResult.totalOutputTokens;

  return {
    totalSpent,
    monthlyAverage: Math.round(monthlyAverage * 100) / 100,
    thirtyDayBurnRate,
    vendorCount,
    invoiceCount,
    trendBuckets,
    trendGranularity,
    vendorBreakdown,
    llmTotalCostUsd,
    llmTotalTokens,
    currency,
  };
}

export async function getDashboardData(filters: DashboardClientFilters) {
  const mapped = dashboardFiltersToServer(filters);
  const stats = await getDashboardStats(mapped);

  // Dashboard page gates on `view_reports` only; vendor filter needs
  // `view_vendors` — skip the fetch when the actor lacks it (sub-users).
  const { hasCap } = await import("@/lib/team/enforce");
  const vendorRows = (await hasCap("view_vendors"))
    ? await getVendors()
    : [];
  const vendors = vendorRows.map((v) => ({ id: v.id, name: v.name }));

  // When the quick filter is "Last 12 months", push its start date down to
  // `getInvoices` via `dateFrom`. If the user also set a custom dateFrom in
  // the advanced filter, take the later of the two (AND of both windows).
  const last12Start =
    mapped.timeRange === "last12Months" ? last12MonthsStartDate() : null;
  const effectiveDateFrom =
    last12Start && (!mapped.dateFrom || mapped.dateFrom < last12Start)
      ? last12Start
      : mapped.dateFrom;

  const invoiceRows = await getInvoices({
    status: "approved",
    type: "expense",
    year: mapped.year,
    months: mapped.months,
    dateFrom: effectiveDateFrom,
    dateTo: mapped.dateTo,
    vendorIds: mapped.vendorIds,
  });

  const showWithoutVat = filters.showWithoutVat;
  const invoicesForTable = invoiceRows.map((row) => {
    const amountStr = row.amount ?? "0";
    const withoutStr = row.amountWithoutVat;
    const displayAmount = showWithoutVat
      ? parseFloat(withoutStr ?? amountStr)
      : parseFloat(amountStr);
    return {
      id: row.id,
      invoiceDate: row.invoiceDate ?? "",
      vendorName: row.vendorName ?? row.suggestedVendorName ?? "Unknown",
      vendorId: row.vendorId,
      suggestedVendorName: row.suggestedVendorName,
      amount: displayAmount,
      vatAmount: row.vatAmount
        ? parseFloat(row.vatAmount)
        : null,
      currency: row.currency ?? "ILS",
      invoiceNumber: row.invoiceNumber,
      fileUrl: row.fileUrl,
      addedMonth: row.addedMonth ?? "",
      status: row.status ?? "approved",
      sentToAccountantAt: row.sentToAccountantAt
        ? new Date(row.sentToAccountantAt).toISOString()
        : null,
    };
  });

  return {
    stats: {
      totalSpent: stats.totalSpent,
      invoiceCount: stats.invoiceCount,
      monthlyAverage: stats.monthlyAverage,
      burnRate: stats.thirtyDayBurnRate,
      vendorCount: stats.vendorCount,
      llmTotalCostUsd: stats.llmTotalCostUsd,
      llmTotalTokens: stats.llmTotalTokens,
      currency: stats.currency,
    },
    trendBuckets: stats.trendBuckets,
    trendGranularity: stats.trendGranularity,
    vendorBreakdown: stats.vendorBreakdown,
    invoices: invoicesForTable,
    vendors,
  };
}

// ---------------------------------------------------------------------------
// Income stats — mirrors the expense dashboard but aggregates `type = income`.
// Uses the same filter + bucketing helpers so both views behave identically
// and can share their filter UI.
// ---------------------------------------------------------------------------

async function getIncomeStats(filters: DashboardFilters = {}) {
  const userId = await requireUserId("view_reports");
  const currency = await getDisplayCurrencyForUser(userId);
  const showWithoutVat = filters.showWithoutVat ?? false;
  const amt = amountSumExpr(showWithoutVat);
  const displayAmt = sqlAmountInDisplayCurrency(amt, currency);

  const baseConditions: ReturnType<typeof eq | typeof sql>[] = [
    eq(invoices.userId, userId),
    eq(invoices.status, "approved"),
    eq(invoices.type, "income"),
    isNull(invoices.outboundInvoiceId),
  ];

  if (filters.timeRange === "last12Months") {
    baseConditions.push(gte(invoices.invoiceDate, last12MonthsStartDate()));
  }
  if (filters.year) {
    baseConditions.push(
      sql`extract(year from ${invoices.invoiceDate}::date) = ${filters.year}`
    );
  }
  if (filters.months && filters.months.length > 0) {
    baseConditions.push(
      inArray(
        sql<number>`extract(month from ${invoices.invoiceDate}::date)::int`,
        filters.months
      )
    );
  }
  if (filters.dateFrom) {
    baseConditions.push(gte(invoices.invoiceDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    baseConditions.push(lte(invoices.invoiceDate, filters.dateTo));
  }
  if (filters.vendorIds && filters.vendorIds.length > 0) {
    baseConditions.push(inArray(invoices.vendorId, filters.vendorIds));
  }

  const [totalResult] = await db
    .select({
      totalEarned: sql<string>`coalesce(sum(${displayAmt}), 0)`,
      invoiceCount: count(invoices.id),
    })
    .from(invoices)
    .where(and(...baseConditions));

  const totalEarned = parseFloat(totalResult.totalEarned);
  const invoiceCount = totalResult.invoiceCount;

  const [clientCountResult] = await db
    .select({
      clientCount:
        sql<number>`count(distinct ${invoices.vendorId})`.mapWith(Number),
    })
    .from(invoices)
    .where(and(...baseConditions));

  const clientCount = clientCountResult.clientCount;

  const groupTrendByDay = shouldGroupTrendByDay(filters);
  const trendGranularity: "day" | "month" = groupTrendByDay ? "day" : "month";
  const trendBucketSql = groupTrendByDay
    ? sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM-DD')`
    : sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`;

  const bucketTotals = await db
    .select({
      bucket: trendBucketSql,
      total: sql<string>`sum(${displayAmt})`,
    })
    .from(invoices)
    .where(and(...baseConditions))
    .groupBy(trendBucketSql)
    .orderBy(trendBucketSql);

  const monthlyAverageRows = groupTrendByDay
    ? await db
        .select({
          month: sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`,
          total: sql<string>`sum(${displayAmt})`,
        })
        .from(invoices)
        .where(and(...baseConditions))
        .groupBy(sql`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`)
    : bucketTotals.map((row) => ({ month: row.bucket, total: row.total }));

  const monthlyAverage =
    monthlyAverageRows.length > 0
      ? monthlyAverageRows.reduce((sum, m) => sum + parseFloat(m.total), 0) /
        monthlyAverageRows.length
      : 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

  const runRateConditions = [
    eq(invoices.userId, userId),
    eq(invoices.status, "approved"),
    eq(invoices.type, "income"),
    isNull(invoices.outboundInvoiceId),
    gte(invoices.invoiceDate, thirtyDaysAgoStr),
  ];
  if (filters.vendorIds && filters.vendorIds.length > 0) {
    runRateConditions.push(inArray(invoices.vendorId, filters.vendorIds));
  }

  const [runRateResult] = await db
    .select({
      total: sql<string>`coalesce(sum(${displayAmt}), 0)`,
    })
    .from(invoices)
    .where(and(...runRateConditions));

  const thirtyDayRunRate = parseFloat(runRateResult.total);

  const trendBuckets = bucketTotals.map((row) => ({
    bucket: row.bucket,
    total: parseFloat(row.total),
  }));

  const clientBreakdownRows = await db
    .select({
      vendorId: invoices.vendorId,
      vendorName: sql<string>`coalesce(${vendors.name}, 'Unknown')`,
      total: sql<string>`sum(${displayAmt})`,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
    )
    .where(and(...baseConditions))
    .groupBy(invoices.vendorId, vendors.name)
    .orderBy(sql`sum(${displayAmt}) desc`);

  const clientBreakdown = clientBreakdownRows.map((row) => ({
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    total: parseFloat(row.total),
  }));

  return {
    totalEarned,
    monthlyAverage: Math.round(monthlyAverage * 100) / 100,
    thirtyDayRunRate,
    clientCount,
    invoiceCount,
    trendBuckets,
    trendGranularity,
    clientBreakdown,
    currency,
  };
}

export async function getIncomeData(filters: DashboardClientFilters) {
  const mapped = dashboardFiltersToServer(filters);
  const stats = await getIncomeStats(mapped);

  const vendorRows = await getVendors();
  // Income clients are vendors flagged as income sources. We still surface
  // every vendor so the filter can show past clients that aren't flagged
  // (legacy data), but lean on the flag for ordering in the future.
  const clients = vendorRows.map((v) => ({ id: v.id, name: v.name }));

  const last12Start =
    mapped.timeRange === "last12Months" ? last12MonthsStartDate() : null;
  const effectiveDateFrom =
    last12Start && (!mapped.dateFrom || mapped.dateFrom < last12Start)
      ? last12Start
      : mapped.dateFrom;

  const invoiceRows = await getInvoices({
    status: "approved",
    type: "income",
    year: mapped.year,
    months: mapped.months,
    dateFrom: effectiveDateFrom,
    dateTo: mapped.dateTo,
    vendorIds: mapped.vendorIds,
    excludeIssuedMirrors: true,
  });

  const showWithoutVat = filters.showWithoutVat;
  const invoicesForTable = invoiceRows.map((row) => {
    const amountStr = row.amount ?? "0";
    const withoutStr = row.amountWithoutVat;
    const displayAmount = showWithoutVat
      ? parseFloat(withoutStr ?? amountStr)
      : parseFloat(amountStr);
    return {
      id: row.id,
      invoiceDate: row.invoiceDate ?? "",
      vendorName: row.vendorName ?? row.suggestedVendorName ?? "Unknown",
      vendorId: row.vendorId,
      suggestedVendorName: row.suggestedVendorName,
      amount: displayAmount,
      vatAmount: row.vatAmount ? parseFloat(row.vatAmount) : null,
      currency: row.currency ?? "ILS",
      invoiceNumber: row.invoiceNumber,
      fileUrl: row.fileUrl,
      addedMonth: row.addedMonth ?? "",
      status: row.status ?? "approved",
      sentToAccountantAt: row.sentToAccountantAt
        ? new Date(row.sentToAccountantAt).toISOString()
        : null,
    };
  });

  return {
    stats: {
      totalEarned: stats.totalEarned,
      invoiceCount: stats.invoiceCount,
      monthlyAverage: stats.monthlyAverage,
      runRate: stats.thirtyDayRunRate,
      clientCount: stats.clientCount,
      currency: stats.currency,
    },
    trendBuckets: stats.trendBuckets,
    trendGranularity: stats.trendGranularity,
    clientBreakdown: stats.clientBreakdown,
    invoices: invoicesForTable,
    clients,
  };
}

// ---------------------------------------------------------------------------
// Profit — issued invoices plus uploaded income, against expenses.
// A credit note deducts. See `sumIssuedIncome`.
// ---------------------------------------------------------------------------

export interface ProfitClientFilters {
  timeRange: DashboardTimeRange;
  year: number | null;
  months: number[];
  dateFrom: string | null;
  dateTo: string | null;
}

export async function getProfitData(filters: ProfitClientFilters) {
  const userId = await requireUserId("view_reports");
  const currency = await getDisplayCurrencyForUser(userId);

  const conditions: ReturnType<typeof eq | typeof sql>[] = [
    eq(invoices.userId, userId),
    eq(invoices.status, "approved"),
    // Issued documents are added again below via sumIssuedIncome.
    // An upload of the same number is that sale too, so it stays out.
    isNull(invoices.outboundInvoiceId),
    sql`NOT (${incomeCoveredByIssuedDocument})`,
  ];

  if (filters.timeRange === "last12Months") {
    conditions.push(gte(invoices.invoiceDate, last12MonthsStartDate()));
  }
  if (filters.year) {
    conditions.push(
      sql`extract(year from ${invoices.invoiceDate}::date) = ${filters.year}`
    );
  }
  if (filters.months && filters.months.length > 0) {
    conditions.push(
      inArray(
        sql<number>`extract(month from ${invoices.invoiceDate}::date)::int`,
        filters.months
      )
    );
  }
  if (filters.dateFrom) {
    conditions.push(gte(invoices.invoiceDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(invoices.invoiceDate, filters.dateTo));
  }

  const displayAmt = sqlAmountInDisplayCurrency(
    sql`${invoices.amount}::numeric`,
    currency
  );

  // Totals split by type so the stat cards can show income/expense/profit
  // in a single query.
  const typeTotals = await db
    .select({
      type: invoices.type,
      total: sql<string>`coalesce(sum(${displayAmt}), 0)`,
      invoiceCount: count(invoices.id),
    })
    .from(invoices)
    .where(and(...conditions))
    .groupBy(invoices.type);

  let totalIncome = 0;
  let totalExpense = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  for (const row of typeTotals) {
    const value = parseFloat(row.total);
    if (row.type === "income") {
      totalIncome = value;
      incomeCount = row.invoiceCount;
    } else if (row.type === "expense") {
      totalExpense = value;
      expenseCount = row.invoiceCount;
    }
  }

  const entity = await getBusinessEntityForUserOrNull(userId);
  const issued = entity
    ? await sumIssuedIncome(entity.id, currency, filters)
    : { total: 0, documentCount: 0, byMonth: [] };
  totalIncome += issued.total;
  incomeCount += issued.documentCount;

  const netProfit = totalIncome - totalExpense;
  const profitMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

  // Monthly buckets, pivoted by type so the client can draw paired bars.
  const monthBucketSql = sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`;
  const monthlyRows = await db
    .select({
      month: monthBucketSql,
      type: invoices.type,
      total: sql<string>`coalesce(sum(${displayAmt}), 0)`,
    })
    .from(invoices)
    .where(and(...conditions))
    .groupBy(monthBucketSql, invoices.type)
    .orderBy(monthBucketSql);

  const monthlyMap = new Map<
    string,
    { income: number; expense: number }
  >();
  for (const row of monthlyRows) {
    const bucket = monthlyMap.get(row.month) ?? { income: 0, expense: 0 };
    const v = parseFloat(row.total);
    if (row.type === "income") bucket.income = v;
    else if (row.type === "expense") bucket.expense = v;
    monthlyMap.set(row.month, bucket);
  }
  for (const row of issued.byMonth) {
    if (row.total === 0) continue;
    const bucket = monthlyMap.get(row.month) ?? { income: 0, expense: 0 };
    bucket.income += row.total;
    monthlyMap.set(row.month, bucket);
  }

  const monthlyBreakdown = Array.from(monthlyMap.entries())
    .map(([month, { income, expense }]) => ({
      month,
      income,
      expense,
      profit: income - expense,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const monthsWithActivity = monthlyBreakdown.length;
  const avgMonthlyProfit =
    monthsWithActivity > 0 ? netProfit / monthsWithActivity : 0;

  const profitableMonths = monthlyBreakdown.filter(
    (m) => m.profit > 0
  ).length;
  const lossMonths = monthlyBreakdown.filter((m) => m.profit < 0).length;

  const bestMonth =
    monthlyBreakdown.length > 0
      ? monthlyBreakdown.reduce((best, m) =>
          m.profit > best.profit ? m : best
        )
      : null;
  const worstMonth =
    monthlyBreakdown.length > 0
      ? monthlyBreakdown.reduce((worst, m) =>
          m.profit < worst.profit ? m : worst
        )
      : null;

  return {
    totalIncome,
    totalExpense,
    netProfit,
    profitMargin: Math.round(profitMargin * 10) / 10,
    incomeCount,
    expenseCount,
    avgMonthlyProfit: Math.round(avgMonthlyProfit * 100) / 100,
    profitableMonths,
    lossMonths,
    monthsWithActivity,
    bestMonth,
    worstMonth,
    monthlyBreakdown,
    currency,
  };
}

// ---------------------------------------------------------------------------
// reportInvoiceProblem — user-initiated support ticket with the invoice
// attached and recent server + client logs included.
// ---------------------------------------------------------------------------

export interface ClientLogPayload {
  timestamp: string;
  level: "log" | "info" | "warn" | "error";
  message: string;
}

function inferContentType(filename: string | null | undefined): string {
  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
}

function formatLogLines(
  title: string,
  entries: Array<{ timestamp: string; level: string; message: string }>
): string {
  if (!entries.length) return `${title}:\n  (none)`;
  const lines = entries.map(
    (e) => `  ${e.timestamp}  ${e.level.toUpperCase().padEnd(6)} ${e.message}`
  );
  return `${title}:\n${lines.join("\n")}`;
}

export async function reportInvoiceProblem(
  invoiceId: string,
  message: string,
  clientLogs: ClientLogPayload[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dict = await getDictionary();
  const userId = await requireUserId("view_invoices");

  const [inv] = await db
    .select({
      id: invoices.id,
      vendorId: invoices.vendorId,
      vendorName: vendors.name,
      type: invoices.type,
      status: invoices.status,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      amount: invoices.amount,
      currency: invoices.currency,
      vatAmount: invoices.vatAmount,
      description: invoices.description,
      fileUrl: invoices.fileUrl,
      fileName: invoices.fileName,
      extractionMethod: invoices.extractionMethod,
      extractionConfidence: invoices.extractionConfidence,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .leftJoin(vendors, eq(invoices.vendorId, vendors.id))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
    .limit(1);

  if (!inv) {
    return { ok: false, error: dict.errors.invoiceNotFoundShort };
  }

  const userRow = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, name: true, email: true, createdAt: true },
  });

  const reportedAt = new Date().toISOString();
  // Marker so the email body always shows at least one server log line if
  // the stream patch is live; if this disappears, the patch never ran.
  console.log(`[reportInvoiceProblem] preparing report at ${reportedAt} for invoice ${inv.id}`);
  const serverLogs: ServerLogEntry[] = getRecentServerLogs(100);

  let attachment: { filename: string; content: Buffer; contentType: string } | null = null;
  if (inv.fileUrl?.trim()) {
    const key = resolveStorageKeyFromFileUrl(inv.fileUrl);
    if (key) {
      try {
        const buf = await downloadFile(key);
        attachment = {
          filename: inv.fileName ?? `invoice-${inv.id}`,
          content: buf,
          contentType: inferContentType(inv.fileName),
        };
      } catch (err) {
        console.warn(
          "[reportInvoiceProblem] failed to download invoice file",
          err
        );
      }
    }
  }

  const subject = `[Problem report] ${inv.vendorName ?? "Unknown vendor"} #${
    inv.invoiceNumber ?? inv.id.slice(0, 8)
  }`;

  const bodyLines = [
    "Invoice problem report",
    "=======================",
    "",
    `Reported at: ${reportedAt}`,
    "",
    "Message from user:",
    message.trim() || "  (no message provided)",
    "",
    "Account",
    "-------",
    `  User ID:        ${userRow?.id ?? userId}`,
    `  Name:           ${userRow?.name ?? "—"}`,
    `  Email:          ${userRow?.email ?? "—"}`,
    `  Account since:  ${
      userRow?.createdAt ? new Date(userRow.createdAt).toISOString() : "—"
    }`,
    "",
    "Invoice",
    "-------",
    `  ID:             ${inv.id}`,
    `  Number:         ${inv.invoiceNumber ?? "—"}`,
    `  Vendor:         ${inv.vendorName ?? "—"}`,
    `  Date:           ${inv.invoiceDate ?? "—"}`,
    `  Amount:         ${inv.amount} ${inv.currency ?? ""}`.trim(),
    `  VAT:            ${inv.vatAmount ?? "—"}`,
    `  Type:           ${inv.type ?? "—"}`,
    `  Status:         ${inv.status ?? "—"}`,
    `  Extraction:     ${inv.extractionMethod ?? "—"} (${inv.extractionConfidence ?? "—"})`,
    `  File:           ${inv.fileName ?? "—"}`,
    `  Created:        ${inv.createdAt ? new Date(inv.createdAt).toISOString() : "—"}`,
    "",
    formatLogLines("Recent server logs (last 100)", serverLogs),
    "",
    formatLogLines("Recent client console logs (last 100)", clientLogs ?? []),
  ];

  const bodyText = bodyLines.join("\n");

  const admin = getAdminEmail();
  if (!admin) {
    warnNoAdminEmail("problem report");
    return { ok: false, error: "ADMIN_EMAIL is not configured" };
  }

  const result = await sendInvoiceEmail({
    to: admin,
    subject,
    bodyText,
    attachment: attachment ?? {
      filename: "report.txt",
      content: Buffer.from(bodyText, "utf8"),
      contentType: "text/plain",
    },
    replyTo: userRow?.email ?? undefined,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  await db.insert(auditLog).values({
    userId,
    invoiceId: inv.id,
    action: "report_problem",
    details: {
      message,
      hasAttachment: Boolean(attachment),
      serverLogCount: serverLogs.length,
      clientLogCount: clientLogs?.length ?? 0,
      reportedAt,
      messageId: result.messageId,
    },
  });

  return { ok: true };
}
