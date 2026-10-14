"use server";

/**
 * Server actions for the auto-detected fixed-asset confirmation flow.
 *
 * The extraction pipeline classifies expense invoices as
 * `is_fixed_asset = true` when they look like capital purchases
 * (computers, vehicles, machinery, multi-year software licenses, …).
 *
 * The user then confirms or dismisses the suggestion. Confirming
 * appends the row to `tax_estimate_inputs.fixed_assets` for the
 * invoice's purchase year so it shows up on the depreciation schedule.
 */

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { invoices, taxEstimateInputs, vendors } from "@/db/schema";
import type { FixedAsset } from "@/db/schema/tax-estimate-inputs";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export interface PendingFixedAssetRow {
  invoiceId: string;
  description: string;
  amount: number;
  currency: string;
  purchaseYear: number;
  invoiceDate: string | null;
  vendorName: string | null;
}

/**
 * Resolve the pre-VAT amount for a depreciable purchase.
 * Falls back to the gross when the extractor never separated VAT.
 */
function preferPreVatAmount(invoice: {
  amount: string;
  amountWithoutVat: string | null;
}): number {
  const net = invoice.amountWithoutVat
    ? Number(invoice.amountWithoutVat)
    : NaN;
  if (Number.isFinite(net) && net > 0) return net;
  const gross = Number(invoice.amount);
  return Number.isFinite(gross) && gross > 0 ? gross : 0;
}

function deriveDescription(
  expenseCategory: string | null,
  vendorName: string | null,
): string {
  const cat = expenseCategory?.trim();
  const vendor = vendorName?.trim();
  if (cat && vendor) return `${cat} (${vendor})`;
  return cat || vendor || "Imported asset";
}

function purchaseYearOf(
  invoiceDate: string | null,
  fallbackYear: number,
): number {
  if (!invoiceDate) return fallbackYear;
  const d = new Date(invoiceDate);
  const y = d.getFullYear();
  return Number.isFinite(y) && y > 2000 ? y : fallbackYear;
}

// ─── Single-invoice sync ─────────────────────────────────────────────────────

export async function syncFixedAssetToTaxEstimates(
  invoiceId: string,
): Promise<{ success: true; year: number }> {
  const userId = await requireUserId();

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)),
    columns: {
      id: true,
      amount: true,
      amountWithoutVat: true,
      invoiceDate: true,
      expenseCategory: true,
      suggestedVendorName: true,
      vendorId: true,
      isFixedAsset: true,
      fixedAssetSynced: true,
    },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.fixedAssetSynced) {
    return {
      success: true,
      year: purchaseYearOf(invoice.invoiceDate, new Date().getFullYear()),
    };
  }

  const vendorRow = invoice.vendorId
    ? await db.query.vendors.findFirst({
        where: eq(vendors.id, invoice.vendorId),
        columns: { name: true },
      })
    : null;

  const currentYear = new Date().getFullYear();
  const year = purchaseYearOf(invoice.invoiceDate, currentYear);
  const amount = preferPreVatAmount(invoice);
  const description = deriveDescription(
    invoice.expenseCategory,
    vendorRow?.name ?? invoice.suggestedVendorName,
  );

  const newAsset: FixedAsset = {
    description,
    amount: Math.round(amount * 100) / 100,
    purchaseYear: year,
  };

  const existing = await db.query.taxEstimateInputs.findFirst({
    where: and(
      eq(taxEstimateInputs.userId, userId),
      eq(taxEstimateInputs.year, year),
    ),
  });

  const merged: FixedAsset[] = existing
    ? [...((existing.fixedAssets ?? []) as FixedAsset[]), newAsset]
    : [newAsset];

  await db
    .insert(taxEstimateInputs)
    .values({
      userId,
      year,
      fixedAssets: merged,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [taxEstimateInputs.userId, taxEstimateInputs.year],
      set: {
        fixedAssets: merged,
        updatedAt: new Date(),
      },
    });

  await db
    .update(invoices)
    .set({ fixedAssetSynced: true, updatedAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)));

  revalidatePath("/outbound/tax-estimates");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");

  return { success: true, year };
}

// ─── Dismiss the prompt without syncing ──────────────────────────────────────

export async function dismissFixedAssetFlag(
  invoiceId: string,
): Promise<{ success: true }> {
  const userId = await requireUserId();

  await db
    .update(invoices)
    .set({ isFixedAsset: false, updatedAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)));

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");

  return { success: true };
}

// ─── Synced-from-invoice keys for the form's badge ───────────────────────────

/**
 * Returns (description.toLowerCase|amount.toFixed(2)|year) keys for invoices
 * already pushed into tax_estimate_inputs.fixed_assets. The form uses these
 * to render a "synced from invoice" badge — purely cosmetic, no state effect.
 */
export async function getSyncedFixedAssetKeys(): Promise<string[]> {
  const userId = await requireUserId();
  const currentYear = new Date().getFullYear();

  const rows = await db
    .select({
      amount: invoices.amount,
      amountWithoutVat: invoices.amountWithoutVat,
      invoiceDate: invoices.invoiceDate,
      expenseCategory: invoices.expenseCategory,
      suggestedVendorName: invoices.suggestedVendorName,
      vendorName: vendors.name,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
    )
    .where(
      and(
        eq(invoices.userId, userId),
        eq(invoices.fixedAssetSynced, true),
        eq(invoices.type, "expense"),
      ),
    );

  return rows.map((r) => {
    const desc = deriveDescription(
      r.expenseCategory,
      r.vendorName ?? r.suggestedVendorName,
    );
    const amount = (Math.round(preferPreVatAmount(r) * 100) / 100).toFixed(2);
    const year = purchaseYearOf(r.invoiceDate, currentYear);
    return `${desc.trim().toLowerCase()}|${amount}|${year}`;
  });
}

// ─── Pending list for the Import picker ──────────────────────────────────────

export async function getPendingFixedAssets(): Promise<PendingFixedAssetRow[]> {
  const userId = await requireUserId();
  const currentYear = new Date().getFullYear();

  const rows = await db
    .select({
      id: invoices.id,
      amount: invoices.amount,
      amountWithoutVat: invoices.amountWithoutVat,
      currency: invoices.currency,
      invoiceDate: invoices.invoiceDate,
      expenseCategory: invoices.expenseCategory,
      suggestedVendorName: invoices.suggestedVendorName,
      vendorName: vendors.name,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
    )
    .where(
      and(
        eq(invoices.userId, userId),
        eq(invoices.isFixedAsset, true),
        eq(invoices.fixedAssetSynced, false),
        eq(invoices.type, "expense"),
      ),
    );

  return rows.map((r) => ({
    invoiceId: r.id,
    description: deriveDescription(
      r.expenseCategory,
      r.vendorName ?? r.suggestedVendorName,
    ),
    amount: preferPreVatAmount(r),
    currency: r.currency ?? "ILS",
    purchaseYear: purchaseYearOf(r.invoiceDate, currentYear),
    invoiceDate: r.invoiceDate,
    vendorName: r.vendorName ?? r.suggestedVendorName,
  }));
}

// ─── Bulk sync from the Import picker ────────────────────────────────────────

export async function syncFixedAssetsBulk(
  invoiceIds: string[],
): Promise<{ success: true; synced: number }> {
  const userId = await requireUserId();
  if (invoiceIds.length === 0) return { success: true, synced: 0 };

  // Fetch only invoices the caller actually owns and that are still in
  // "needs sync" state — guards against stale form submissions.
  const rows = await db
    .select({
      id: invoices.id,
      amount: invoices.amount,
      amountWithoutVat: invoices.amountWithoutVat,
      invoiceDate: invoices.invoiceDate,
      expenseCategory: invoices.expenseCategory,
      suggestedVendorName: invoices.suggestedVendorName,
      vendorId: invoices.vendorId,
      vendorName: vendors.name,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
    )
    .where(
      and(
        eq(invoices.userId, userId),
        eq(invoices.isFixedAsset, true),
        eq(invoices.fixedAssetSynced, false),
        inArray(invoices.id, invoiceIds),
      ),
    );

  if (rows.length === 0) return { success: true, synced: 0 };

  const currentYear = new Date().getFullYear();

  // Group by year so each tax_estimate_inputs row is updated once.
  const byYear = new Map<number, FixedAsset[]>();
  for (const r of rows) {
    const y = purchaseYearOf(r.invoiceDate, currentYear);
    const list = byYear.get(y) ?? [];
    list.push({
      description: deriveDescription(
        r.expenseCategory,
        r.vendorName ?? r.suggestedVendorName,
      ),
      amount: Math.round(preferPreVatAmount(r) * 100) / 100,
      purchaseYear: y,
    });
    byYear.set(y, list);
  }

  for (const [year, additions] of byYear) {
    const existing = await db.query.taxEstimateInputs.findFirst({
      where: and(
        eq(taxEstimateInputs.userId, userId),
        eq(taxEstimateInputs.year, year),
      ),
    });
    const merged: FixedAsset[] = [
      ...(((existing?.fixedAssets ?? []) as FixedAsset[]) || []),
      ...additions,
    ];

    await db
      .insert(taxEstimateInputs)
      .values({
        userId,
        year,
        fixedAssets: merged,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [taxEstimateInputs.userId, taxEstimateInputs.year],
        set: { fixedAssets: merged, updatedAt: new Date() },
      });
  }

  await db
    .update(invoices)
    .set({ fixedAssetSynced: true, updatedAt: new Date() })
    .where(
      and(
        eq(invoices.userId, userId),
        inArray(
          invoices.id,
          rows.map((r) => r.id),
        ),
      ),
    );

  revalidatePath("/outbound/tax-estimates");
  revalidatePath("/invoices");

  return { success: true, synced: rows.length };
}
