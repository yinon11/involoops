"use server";

import { db } from "@/db";
import { vendors, invoices, extractionRules } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, sql, count } from "drizzle-orm";
import { getDictionary } from "@/lib/i18n/server";
import { format } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    const dict = await getDictionary();
    throw new Error(dict.errors.unauthorized);
  }
  return session.user.id;
}

// ---------------------------------------------------------------------------
// getVendors
// ---------------------------------------------------------------------------

export async function getVendors() {
  const userId = await requireUserId();

  const rows = await db
    .select({
      id: vendors.id,
      userId: vendors.userId,
      name: vendors.name,
      aliases: vendors.aliases,
      defaultCategory: vendors.defaultCategory,
      isIncomeSource: vendors.isIncomeSource,
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
  const userId = await requireUserId();

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
// createVendor
// ---------------------------------------------------------------------------

export async function createVendor(data: {
  name: string;
  aliases?: string[];
  defaultCategory?: string;
  isIncomeSource?: boolean;
}) {
  const userId = await requireUserId();

  const [vendor] = await db
    .insert(vendors)
    .values({
      userId,
      name: data.name,
      aliases: data.aliases ?? [],
      defaultCategory: data.defaultCategory ?? null,
      isIncomeSource: data.isIncomeSource ?? false,
    })
    .returning();

  return vendor;
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
  }>
) {
  const userId = await requireUserId();
  const dict = await getDictionary();

  const existing = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, id), eq(vendors.userId, userId)),
  });

  if (!existing) {
    throw new Error(dict.errors.vendorNotFound);
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

export async function deleteVendor(id: string) {
  const userId = await requireUserId();
  const dict = await getDictionary();

  const existing = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, id), eq(vendors.userId, userId)),
  });

  if (!existing) {
    throw new Error(dict.errors.vendorNotFound);
  }

  // Check if any invoices reference this vendor
  const [result] = await db
    .select({ invoiceCount: count(invoices.id) })
    .from(invoices)
    .where(eq(invoices.vendorId, id));

  if (result.invoiceCount > 0) {
    throw new Error(
      format(dict.errors.vendorHasInvoices, {
        name: existing.name,
        count: result.invoiceCount,
      })
    );
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
// getVendorRules
// ---------------------------------------------------------------------------

export async function getVendorRules(vendorId: string) {
  const userId = await requireUserId();

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
// saveVendorRule
// ---------------------------------------------------------------------------

export async function saveVendorRule(data: {
  id?: string;
  vendorId: string;
  name?: string;
  priority?: number;
  rules: Record<string, unknown>;
  isActive?: boolean;
}) {
  const userId = await requireUserId();
  const dict = await getDictionary();

  // Verify vendor belongs to user
  const vendor = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, data.vendorId), eq(vendors.userId, userId)),
  });

  if (!vendor) {
    throw new Error(dict.errors.vendorNotFound);
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
      vendorId: data.vendorId,
      name: data.name ?? null,
      priority: data.priority ?? 0,
      rules: data.rules,
      isActive: data.isActive ?? true,
    })
    .returning();

  return created;
}
