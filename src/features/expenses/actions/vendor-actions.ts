"use server";

import { db } from "@/db";
import { vendors, invoices, extractionRules } from "@/db/schema";
import { eq, and, sql, count, isNull, inArray, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ActionResult, ActionResultWith } from "@/types/action-result";
import { requireActorUserId as requireUserId } from "@/lib/team/enforce";
import { getDictionary } from "@/lib/i18n/server";

// ---------------------------------------------------------------------------
// getVendors
// ---------------------------------------------------------------------------

export async function getVendors() {
  const userId = await requireUserId("view_vendors");

  const rows = await db
    .select({
      id: vendors.id,
      userId: vendors.userId,
      name: vendors.name,
      aliases: vendors.aliases,
      defaultCategory: vendors.defaultCategory,
      isIncomeSource: vendors.isIncomeSource,
      autoApprove: vendors.autoApprove,
      trackingExcluded: vendors.trackingExcluded,
      createdAt: vendors.createdAt,
      invoiceCount: sql<number>`count(${invoices.id})`.mapWith(Number),
    })
    .from(vendors)
    .leftJoin(invoices, eq(vendors.id, invoices.vendorId))
    .where(eq(vendors.userId, userId))
    .groupBy(vendors.id)
    .orderBy(vendors.name);

  return rows;
}

// ---------------------------------------------------------------------------
// getVendorById
// ---------------------------------------------------------------------------

export async function getVendorById(id: string) {
  const userId = await requireUserId("view_vendors");

  const vendor = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, id), eq(vendors.userId, userId)),
  });

  if (!vendor) return null;

  const rules = await db
    .select()
    .from(extractionRules)
    .where(
      and(
        eq(extractionRules.vendorId, id),
        eq(extractionRules.userId, userId)
      )
    );

  return { ...vendor, extractionRules: rules };
}

// ---------------------------------------------------------------------------
// findVendorByNameOrAlias — case-insensitive lookup against name + aliases.
// Used by pending flows so a name that matches an existing vendor's alias
// resolves to that vendor instead of creating a duplicate.
// ---------------------------------------------------------------------------

export async function findVendorByNameOrAlias(rawName: string) {
  const userId = await requireUserId();
  const name = rawName.trim();
  if (!name) return null;

  const found = await db
    .select()
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
        )`
      )
    )
    .limit(1);

  return found[0] ?? null;
}

// ---------------------------------------------------------------------------
// createVendor
// ---------------------------------------------------------------------------

export async function createVendor(data: {
  name: string;
  aliases?: string[];
  defaultCategory?: string;
  isIncomeSource?: boolean;
  autoApprove?: boolean;
}) {
  const userId = await requireUserId("manage_vendors");

  const [vendor] = await db
    .insert(vendors)
    .values({
      userId,
      name: data.name,
      aliases: data.aliases ?? [],
      defaultCategory: data.defaultCategory ?? null,
      isIncomeSource: data.isIncomeSource ?? false,
      autoApprove: data.autoApprove ?? false,
    })
    .returning();

  return vendor;
}

// ---------------------------------------------------------------------------
// addVendorAlias — append a new alias to a vendor, skipping duplicates
// ---------------------------------------------------------------------------

/**
 * Stores an additional alias on the vendor. Used when linking an invoice to an
 * existing vendor via the vendor-resolution panel: the text the extractor
 * produced (which clearly didn't match any existing vendor) is remembered so
 * the next invoice that carries the same garbage label can be auto-linked.
 *
 * No-ops when the alias is blank, already present (case-insensitive), or
 * identical to the vendor's primary name.
 */
export async function addVendorAlias(vendorId: string, alias: string) {
  const userId = await requireUserId("manage_vendors");

  const trimmed = alias.trim();
  if (!trimmed) return { success: true as const, added: false };

  const existing = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, vendorId), eq(vendors.userId, userId)),
  });

  if (!existing) {
    throw new Error("Vendor not found");
  }

  const currentAliases = ((existing.aliases ?? []) as string[]).filter(
    (a) => typeof a === "string"
  );
  const lower = trimmed.toLowerCase();

  if (existing.name.trim().toLowerCase() === lower) {
    return { success: true as const, added: false };
  }
  if (currentAliases.some((a) => a.trim().toLowerCase() === lower)) {
    return { success: true as const, added: false };
  }

  await db
    .update(vendors)
    .set({ aliases: [...currentAliases, trimmed] })
    .where(and(eq(vendors.id, vendorId), eq(vendors.userId, userId)));

  return { success: true as const, added: true };
}

// ---------------------------------------------------------------------------
// updateVendor
// ---------------------------------------------------------------------------

export async function updateVendor(
  id: string,
  data: Partial<{
    name: string;
    aliases: string[];
    defaultCategory: string;
    isIncomeSource: boolean;
    autoApprove: boolean;
    trackingExcluded: boolean;
  }>
) {
  const userId = await requireUserId("manage_vendors");

  const existing = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, id), eq(vendors.userId, userId)),
  });

  if (!existing) {
    throw new Error("Vendor not found");
  }

  const [updated] = await db
    .update(vendors)
    .set(data)
    .where(and(eq(vendors.id, id), eq(vendors.userId, userId)))
    .returning();

  return updated;
}

// ---------------------------------------------------------------------------
// deleteVendor
// ---------------------------------------------------------------------------

export async function deleteVendor(id: string): Promise<ActionResult> {
  const userId = await requireUserId("manage_vendors");

  const existing = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, id), eq(vendors.userId, userId)),
  });

  if (!existing) {
    throw new Error("Vendor not found");
  }

  // Check if any invoices reference this vendor
  const [result] = await db
    .select({ invoiceCount: count(invoices.id) })
    .from(invoices)
    .where(eq(invoices.vendorId, id));

  if (result.invoiceCount > 0) {
    return {
      success: false,
      error: `Cannot delete vendor "${existing.name}" because ${result.invoiceCount} invoice(s) reference it.`,
    };
  }

  // Also remove any extraction rules for this vendor
  await db
    .delete(extractionRules)
    .where(
      and(
        eq(extractionRules.vendorId, id),
        eq(extractionRules.userId, userId)
      )
    );

  await db
    .delete(vendors)
    .where(and(eq(vendors.id, id), eq(vendors.userId, userId)));

  return { success: true };
}

// ---------------------------------------------------------------------------
// mergeVendors — collapse several vendors into one. Source names + aliases
// become aliases on the target, all invoices/extraction rules are reassigned
// to the target, and the source vendor rows are deleted.
// ---------------------------------------------------------------------------

export async function mergeVendors(params: {
  targetVendorId: string;
  sourceVendorIds: string[];
}): Promise<
  ActionResultWith<{
    vendor: typeof vendors.$inferSelect;
    mergedSourceCount: number;
  }>
> {
  const dict = await getDictionary();
  const userId = await requireUserId("manage_vendors");
  const { targetVendorId } = params;

  if (!targetVendorId) {
    return { success: false, error: dict.errors.pickVendorToKeep };
  }

  const sourceIds = Array.from(
    new Set(params.sourceVendorIds.filter((id) => id && id !== targetVendorId))
  );
  if (sourceIds.length === 0) {
    return {
      success: false,
      error: dict.errors.selectVendorToMerge,
    };
  }

  const merged = await db.transaction(async (tx) => {
    const target = await tx.query.vendors.findFirst({
      where: and(eq(vendors.id, targetVendorId), eq(vendors.userId, userId)),
    });
    if (!target) {
      throw new Error("Target vendor not found");
    }

    const sources = await tx
      .select()
      .from(vendors)
      .where(
        and(inArray(vendors.id, sourceIds), eq(vendors.userId, userId))
      );

    if (sources.length !== sourceIds.length) {
      throw new Error("One or more vendors to merge could not be found");
    }

    // Build merged alias list: union of target's aliases + each source's name
    // and aliases. Dedupe case-insensitively and drop anything that equals the
    // target's own name.
    const targetNameKey = target.name.trim().toLowerCase();
    const seen = new Map<string, string>();

    const addAlias = (raw: string | null | undefined) => {
      if (!raw) return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (key === targetNameKey) return;
      if (!seen.has(key)) seen.set(key, trimmed);
    };

    for (const a of target.aliases ?? []) addAlias(a);
    for (const s of sources) {
      addAlias(s.name);
      for (const a of s.aliases ?? []) addAlias(a);
    }

    const mergedAliases = Array.from(seen.values());

    // Reassign invoices to the target vendor.
    await tx
      .update(invoices)
      .set({ vendorId: targetVendorId, updatedAt: new Date() })
      .where(
        and(
          eq(invoices.userId, userId),
          inArray(invoices.vendorId, sourceIds)
        )
      );

    // Reassign extraction rules to the target vendor.
    await tx
      .update(extractionRules)
      .set({ vendorId: targetVendorId, updatedAt: new Date() })
      .where(
        and(
          eq(extractionRules.userId, userId),
          inArray(extractionRules.vendorId, sourceIds)
        )
      );

    // Delete the now-empty source vendors.
    await tx
      .delete(vendors)
      .where(
        and(eq(vendors.userId, userId), inArray(vendors.id, sourceIds))
      );

    // Save the merged alias list on the target vendor.
    const [updated] = await tx
      .update(vendors)
      .set({ aliases: mergedAliases })
      .where(
        and(eq(vendors.id, targetVendorId), eq(vendors.userId, userId))
      )
      .returning();

    return {
      vendor: updated,
      mergedSourceCount: sources.length,
    };
  });

  revalidatePath("/vendors");
  revalidatePath(`/vendors/${targetVendorId}`);
  revalidatePath("/invoices");
  revalidatePath("/pending");

  return { success: true, ...merged };
}

// ---------------------------------------------------------------------------
// getVendorRules
// ---------------------------------------------------------------------------

export async function getVendorRules(vendorId: string) {
  const userId = await requireUserId("view_vendors");

  const rules = await db
    .select()
    .from(extractionRules)
    .where(
      and(
        eq(extractionRules.vendorId, vendorId),
        eq(extractionRules.userId, userId)
      )
    )
    .orderBy(extractionRules.priority);

  return rules;
}

// ---------------------------------------------------------------------------
// getGlobalExtractionRules — vendor_id IS NULL (applies to all invoices)
// ---------------------------------------------------------------------------

export async function getGlobalExtractionRules() {
  const userId = await requireUserId("view_vendors");

  const rules = await db
    .select()
    .from(extractionRules)
    .where(
      and(
        eq(extractionRules.userId, userId),
        isNull(extractionRules.vendorId)
      )
    )
    .orderBy(extractionRules.priority);

  return rules;
}

// ---------------------------------------------------------------------------
// saveVendorRule
// ---------------------------------------------------------------------------

export async function saveVendorRule(data: {
  id?: string;
  /** `null` = global rule for all invoices (text path). */
  vendorId: string | null;
  name?: string;
  priority?: number;
  rules: Record<string, unknown>;
  isActive?: boolean;
}) {
  const userId = await requireUserId("manage_vendors");

  if (data.vendorId != null) {
    const vendor = await db.query.vendors.findFirst({
      where: and(eq(vendors.id, data.vendorId), eq(vendors.userId, userId)),
    });

    if (!vendor) {
      throw new Error("Vendor not found");
    }
  }

  if (data.id) {
    // Update existing rule
    const [updated] = await db
      .update(extractionRules)
      .set({
        name: data.name,
        priority: data.priority,
        rules: data.rules,
        isActive: data.isActive,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(extractionRules.id, data.id),
          eq(extractionRules.userId, userId)
        )
      )
      .returning();

    return updated;
  }

  // Create new rule
  const [created] = await db
    .insert(extractionRules)
    .values({
      userId,
      vendorId: data.vendorId ?? null,
      name: data.name ?? null,
      priority: data.priority ?? 0,
      rules: data.rules,
      isActive: data.isActive ?? true,
    })
    .returning();

  return created;
}

// ---------------------------------------------------------------------------
// deleteVendorRule
// ---------------------------------------------------------------------------

export async function deleteVendorRule(ruleId: string) {
  const userId = await requireUserId("manage_vendors");

  const existing = await db.query.extractionRules.findFirst({
    where: and(
      eq(extractionRules.id, ruleId),
      eq(extractionRules.userId, userId)
    ),
  });

  if (!existing) {
    throw new Error("Note not found");
  }

  await db
    .delete(extractionRules)
    .where(
      and(eq(extractionRules.id, ruleId), eq(extractionRules.userId, userId))
    );

  return { success: true as const };
}

// ---------------------------------------------------------------------------
// getVendorTrackingData — vendors with >1 invoice, with monthly counts
// ---------------------------------------------------------------------------

export interface VendorTrackingInvoice {
  id: string;
  invoiceDate: string;
  amount: string;
  currency: string;
  invoiceNumber: string | null;
  createdAt: Date | null;
  addedMonth: string | null;
}

export interface VendorTrackingEntry {
  vendorId: string;
  vendorName: string;
  totalInvoiceCount: number;
  issuedThisMonth: number;
  uploadedThisMonth: number;
  websiteUrl: string | null;
  websiteUrl2: string | null;
  recentInvoices: VendorTrackingInvoice[];
}

/**
 * Returns all vendors that have more than 1 invoice in total,
 * enriched with counts for the given month (YYYY-MM).
 */
export async function getVendorTrackingData(
  month: string
): Promise<VendorTrackingEntry[]> {
  const userId = await requireUserId("view_vendors");

  // 1. Get all vendors with >1 invoice, excluding ones the user removed from tracking
  const vendorRows = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      websiteUrl: vendors.websiteUrl,
      websiteUrl2: vendors.websiteUrl2,
      invoiceCount: sql<number>`count(${invoices.id})`.mapWith(Number),
    })
    .from(vendors)
    .leftJoin(invoices, eq(vendors.id, invoices.vendorId))
    .where(
      and(
        eq(vendors.userId, userId),
        sql`coalesce(${vendors.trackingExcluded}, false) = false`
      )
    )
    .groupBy(vendors.id)
    .having(sql`count(${invoices.id}) > 1`)
    .orderBy(vendors.name);

  if (vendorRows.length === 0) return [];

  const vendorIds = vendorRows.map((v) => v.id);

  // 2. Get per-vendor count of invoices "issued this month" (invoiceDate in month)
  // month is YYYY-MM, invoiceDate is a date column
  const [year, monthNum] = month.split("-").map(Number);
  const monthStart = `${year}-${String(monthNum).padStart(2, "0")}-01`;
  // Calculate last day of month
  const lastDay = new Date(year, monthNum, 0).getDate();
  const monthEnd = `${year}-${String(monthNum).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const issuedCounts = await db
    .select({
      vendorId: invoices.vendorId,
      count: count(invoices.id),
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        inArray(invoices.vendorId, vendorIds),
        sql`${invoices.invoiceDate} >= ${monthStart}`,
        sql`${invoices.invoiceDate} <= ${monthEnd}`
      )
    )
    .groupBy(invoices.vendorId);

  const issuedMap = new Map(
    issuedCounts.map((r) => [r.vendorId, r.count])
  );

  // 3. Get per-vendor count of invoices "uploaded this month" (addedMonth = YYYY-MM)
  const uploadedCounts = await db
    .select({
      vendorId: invoices.vendorId,
      count: count(invoices.id),
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        inArray(invoices.vendorId, vendorIds),
        eq(invoices.addedMonth, month)
      )
    )
    .groupBy(invoices.vendorId);

  const uploadedMap = new Map(
    uploadedCounts.map((r) => [r.vendorId, r.count])
  );

  // 4. Get recent invoices for each vendor (last 10 per vendor, ordered by invoiceDate desc)
  const recentInvoices = await db
    .select({
      id: invoices.id,
      vendorId: invoices.vendorId,
      invoiceDate: invoices.invoiceDate,
      amount: invoices.amount,
      currency: invoices.currency,
      invoiceNumber: invoices.invoiceNumber,
      createdAt: invoices.createdAt,
      addedMonth: invoices.addedMonth,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        inArray(invoices.vendorId, vendorIds)
      )
    )
    .orderBy(desc(invoices.invoiceDate));

  // Group invoices by vendor
  const invoicesByVendor = new Map<string, VendorTrackingInvoice[]>();
  for (const inv of recentInvoices) {
    if (!inv.vendorId) continue;
    const list = invoicesByVendor.get(inv.vendorId) ?? [];
    if (list.length < 10) {
      list.push({
        id: inv.id,
        invoiceDate: inv.invoiceDate ?? "",
        amount: inv.amount,
        currency: inv.currency ?? "ILS",
        invoiceNumber: inv.invoiceNumber,
        createdAt: inv.createdAt,
        addedMonth: inv.addedMonth,
      });
    }
    invoicesByVendor.set(inv.vendorId, list);
  }

  return vendorRows.map((v) => ({
    vendorId: v.id,
    vendorName: v.name,
    totalInvoiceCount: v.invoiceCount,
    issuedThisMonth: issuedMap.get(v.id) ?? 0,
    uploadedThisMonth: uploadedMap.get(v.id) ?? 0,
    websiteUrl: v.websiteUrl ?? null,
    websiteUrl2: v.websiteUrl2 ?? null,
    recentInvoices: invoicesByVendor.get(v.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// updateVendorWebsiteUrl
// ---------------------------------------------------------------------------

export async function updateVendorWebsiteUrl(
  vendorId: string,
  url: string | null,
  slot: 1 | 2 = 1
) {
  const userId = await requireUserId("manage_vendors");

  const existing = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, vendorId), eq(vendors.userId, userId)),
  });

  if (!existing) {
    throw new Error("Vendor not found");
  }

  const value = url?.trim() || null;
  const setData = slot === 2 ? { websiteUrl2: value } : { websiteUrl: value };

  await db
    .update(vendors)
    .set(setData)
    .where(and(eq(vendors.id, vendorId), eq(vendors.userId, userId)));

  revalidatePath("/dashboard");
  return { success: true as const };
}
