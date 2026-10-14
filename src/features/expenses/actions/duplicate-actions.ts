"use server";

import { db } from "@/db";
import { invoices, vendors, dismissedDuplicatePairs } from "@/db/schema";
import { auth } from "@/auth";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { bulkApprove } from "@/features/expenses/actions/invoice-actions";
import type { ActionResultWith } from "@/types/action-result";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

/**
 * Canonical key for an unordered pair of invoice ids. Must match the table's
 * `invoice_id_a < invoice_id_b` ordering so we can look up dismissal rows.
 */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface DuplicateInvoice {
  id: string;
  vendorId: string | null;
  vendorName: string | null;
  suggestedVendorName: string | null;
  status: "processing" | "pending" | "approved" | "rejected" | null;
  type: "expense" | "income" | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: string;
  currency: string | null;
  vatAmount: string | null;
  amountWithoutVat: string | null;
  description: string | null;
  fileUrl: string | null;
  fileName: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * How the invoices in a duplicate group were matched.
 * - `vendor_amount_date`: same vendor (or suggested name) + amount + document date
 * - `invoice_number`: same invoice number (regardless of vendor/amount/date)
 */
export type DuplicateMatchReason = "vendor_amount_date" | "invoice_number";

export interface DuplicateGroup {
  /** Stable key identifying this group. */
  key: string;
  /** Why these invoices were grouped together. */
  matchReason: DuplicateMatchReason;
  /** Display label for the vendor / suggested vendor (best effort for number-matched groups). */
  vendorLabel: string;
  /** Whether the group was matched by linked vendor (true) or by suggested name (false). */
  linkedVendor: boolean;
  /** Common amount when matched by vendor+amount+date; null for number-matched groups. */
  amount: string | null;
  currency: string | null;
  /** Common date when matched by vendor+amount+date; null for number-matched groups. */
  invoiceDate: string | null;
  /** Shared invoice number when matched by invoice number; null otherwise. */
  sharedInvoiceNumber: string | null;
  invoices: DuplicateInvoice[];
}

/**
 * Find invoices that look like duplicates. Two kinds of groups are returned:
 *
 * 1. Semantic overlap: same vendor (or same suggested vendor name when
 *    unlinked), same amount, same document date.
 * 2. Shared invoice number: two or more invoices carrying the same invoice
 *    number, regardless of vendor / amount / date.
 *
 * Rejected invoices are excluded because they've already been dispositioned.
 * Groups with the exact same set of member ids across both kinds are deduped —
 * we keep the vendor+amount+date grouping in that case.
 */
export async function getDuplicateInvoiceGroups(): Promise<DuplicateGroup[]> {
  const userId = await requireUserId();

  // Step 1a: group by vendor + amount + date. A synthetic vendor key catches
  // both linked-vendor and suggested-name duplicates.
  const vendorKeyExpr = sql<string>`coalesce(${invoices.vendorId}::text, 'suggested:' || lower(btrim(${invoices.suggestedVendorName})))`;

  const vendorGroupRows = await db
    .select({
      vendorKey: vendorKeyExpr,
      amount: invoices.amount,
      invoiceDate: invoices.invoiceDate,
      ids: sql<string[]>`array_agg(${invoices.id}::text order by ${invoices.createdAt} desc)`,
      latestCreatedAt: sql<string | null>`max(${invoices.createdAt})`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        sql`${invoices.invoiceDate} is not null`,
        sql`${invoices.amount} is not null`,
        sql`${invoices.status} <> 'rejected'`,
        sql`(${invoices.vendorId} is not null or btrim(coalesce(${invoices.suggestedVendorName}, '')) <> '')`
      )
    )
    .groupBy(vendorKeyExpr, invoices.amount, invoices.invoiceDate)
    .having(sql`count(*) > 1`)
    .orderBy(desc(sql`max(${invoices.createdAt})`));

  // Step 1b: group by trimmed invoice number (non-empty).
  const numberKeyExpr = sql<string>`btrim(${invoices.invoiceNumber})`;

  const numberGroupRows = await db
    .select({
      invoiceNumber: numberKeyExpr,
      ids: sql<string[]>`array_agg(${invoices.id}::text order by ${invoices.createdAt} desc)`,
      latestCreatedAt: sql<string | null>`max(${invoices.createdAt})`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        sql`${invoices.status} <> 'rejected'`,
        sql`btrim(coalesce(${invoices.invoiceNumber}, '')) <> ''`
      )
    )
    .groupBy(numberKeyExpr)
    .having(sql`count(*) > 1`)
    .orderBy(desc(sql`max(${invoices.createdAt})`));

  if (vendorGroupRows.length === 0 && numberGroupRows.length === 0) return [];

  // Step 2: fetch full invoice details for every id in any duplicate group.
  const allIds = Array.from(
    new Set([
      ...vendorGroupRows.flatMap((g) => g.ids),
      ...numberGroupRows.flatMap((g) => g.ids),
    ])
  );

  // Load every "not a duplicate" confirmation the user has made among these
  // invoices. A group is hidden only when EVERY pair inside it has been
  // dismissed — so a brand-new invoice joining the group still resurfaces it.
  const dismissedRows = allIds.length
    ? await db
        .select({
          a: dismissedDuplicatePairs.invoiceIdA,
          b: dismissedDuplicatePairs.invoiceIdB,
        })
        .from(dismissedDuplicatePairs)
        .where(
          and(
            eq(dismissedDuplicatePairs.userId, userId),
            inArray(dismissedDuplicatePairs.invoiceIdA, allIds),
            inArray(dismissedDuplicatePairs.invoiceIdB, allIds)
          )
        )
    : [];
  const dismissedPairSet = new Set(
    dismissedRows.map((r) => pairKey(r.a, r.b))
  );
  const isGroupFullyDismissed = (ids: string[]): boolean => {
    if (ids.length < 2) return false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (!dismissedPairSet.has(pairKey(ids[i], ids[j]))) return false;
      }
    }
    return true;
  };

  const invoiceRows = await db
    .select({
      id: invoices.id,
      vendorId: invoices.vendorId,
      vendorName: vendors.name,
      suggestedVendorName: invoices.suggestedVendorName,
      status: invoices.status,
      type: invoices.type,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      amount: invoices.amount,
      currency: invoices.currency,
      vatAmount: invoices.vatAmount,
      amountWithoutVat: invoices.amountWithoutVat,
      description: invoices.description,
      fileUrl: invoices.fileUrl,
      fileName: invoices.fileName,
      createdAt: invoices.createdAt,
      updatedAt: invoices.updatedAt,
    })
    .from(invoices)
    .leftJoin(
      vendors,
      and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId))
    )
    .where(and(eq(invoices.userId, userId), inArray(invoices.id, allIds)));

  const byId = new Map(invoiceRows.map((row) => [row.id, row]));

  const toMembers = (ids: string[]): DuplicateInvoice[] =>
    ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => !!row)
      .map((row) => ({
        id: row.id,
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        suggestedVendorName: row.suggestedVendorName,
        status: row.status,
        type: row.type,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: row.invoiceDate,
        amount: row.amount,
        currency: row.currency,
        vatAmount: row.vatAmount,
        amountWithoutVat: row.amountWithoutVat,
        description: row.description,
        fileUrl: row.fileUrl,
        fileName: row.fileName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

  // Track ID-sets we've already emitted so vendor+amount+date groups that also
  // share an invoice number don't double-show as a second card.
  const seenIdSets = new Set<string>();
  const idSetKey = (ids: string[]) => [...ids].sort().join(",");

  const groups: DuplicateGroup[] = [];

  // Step 3a: shape vendor+amount+date groups first (preferred when overlap).
  for (const g of vendorGroupRows) {
    const members = toMembers(g.ids);
    if (members.length < 2) continue;

    const memberIds = members.map((m) => m.id);
    if (isGroupFullyDismissed(memberIds)) {
      // All pairs confirmed not-a-duplicate — still mark the set as "seen" so
      // an identical invoice-number group doesn't resurrect it below.
      seenIdSets.add(idSetKey(memberIds));
      continue;
    }

    const linkedVendor = !g.vendorKey.startsWith("suggested:");
    const vendorLabel = linkedVendor
      ? (members.find((m) => m.vendorName)?.vendorName ?? "Unknown vendor")
      : (members.find((m) => m.suggestedVendorName)?.suggestedVendorName?.trim() ??
          "Unknown vendor");

    seenIdSets.add(idSetKey(members.map((m) => m.id)));

    groups.push({
      key: `vad|${g.vendorKey}|${g.amount}|${g.invoiceDate ?? ""}`,
      matchReason: "vendor_amount_date",
      vendorLabel,
      linkedVendor,
      amount: g.amount,
      currency: members[0]?.currency ?? null,
      invoiceDate: g.invoiceDate ?? "",
      sharedInvoiceNumber: null,
      invoices: members,
    });
  }

  // Step 3b: shape invoice-number groups, skipping any whose member set was
  // already emitted by the vendor+amount+date pass.
  for (const g of numberGroupRows) {
    const members = toMembers(g.ids);
    if (members.length < 2) continue;

    const memberIds = members.map((m) => m.id);
    const setKey = idSetKey(memberIds);
    if (seenIdSets.has(setKey)) continue;
    seenIdSets.add(setKey);

    if (isGroupFullyDismissed(memberIds)) continue;

    const vendorLabel =
      members.find((m) => m.vendorName)?.vendorName ??
      members.find((m) => m.suggestedVendorName)?.suggestedVendorName?.trim() ??
      "Unknown vendor";
    const linkedVendor = members.some((m) => m.vendorId);

    groups.push({
      key: `num|${g.invoiceNumber}`,
      matchReason: "invoice_number",
      vendorLabel,
      linkedVendor,
      amount: null,
      currency: members[0]?.currency ?? null,
      invoiceDate: null,
      sharedInvoiceNumber: g.invoiceNumber,
      invoices: members,
    });
  }

  return groups;
}

/**
 * Confirm that the given invoices are NOT duplicates of each other. Any
 * pending members are approved in the same call (reusing `bulkApprove`), and
 * every pairwise combination is recorded in `dismissed_duplicate_pairs` so the
 * group stops appearing on the Duplicates page. If a new invoice later joins
 * the same logical group it will still surface — only the specific pairs that
 * were confirmed here are suppressed.
 */
export async function dismissDuplicateGroup(
  invoiceIds: string[]
): Promise<
  ActionResultWith<{
    approved: number;
    skipped: number;
    dismissedPairs: number;
  }>
> {
  const userId = await requireUserId();

  const uniqueIds = Array.from(new Set(invoiceIds.filter((id) => !!id)));
  if (uniqueIds.length < 2) {
    return {
      success: false,
      error:
        "At least two invoices are required to dismiss a duplicate group.",
    };
  }

  // Defence-in-depth: only operate on invoices the caller actually owns.
  const owned = await db
    .select({ id: invoices.id, status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.userId, userId), inArray(invoices.id, uniqueIds)));

  if (owned.length !== uniqueIds.length) {
    throw new Error("Invoice not found");
  }

  // Approve any pending invoices in the group — confirming "not a duplicate"
  // while leaving one in pending would leave the group half-resolved.
  const pendingIds = owned
    .filter((row) => row.status === "pending")
    .map((row) => row.id);
  let approved = 0;
  let skipped = 0;
  if (pendingIds.length > 0) {
    const res = await bulkApprove(pendingIds);
    if (!res.success) {
      // Propagate the actionable validation message (e.g. "needs vendor")
      // up to the duplicates UI instead of swallowing it.
      return { success: false, error: res.error };
    }
    approved = res.approved;
    skipped = res.skipped;
  }

  // Write a row for every unordered pair; on-conflict do nothing so repeated
  // clicks are idempotent.
  const sorted = [...uniqueIds].sort();
  const rows: { userId: string; invoiceIdA: string; invoiceIdB: string }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      rows.push({
        userId,
        invoiceIdA: sorted[i],
        invoiceIdB: sorted[j],
      });
    }
  }

  await db
    .insert(dismissedDuplicatePairs)
    .values(rows)
    .onConflictDoNothing({
      target: [
        dismissedDuplicatePairs.userId,
        dismissedDuplicatePairs.invoiceIdA,
        dismissedDuplicatePairs.invoiceIdB,
      ],
    });

  revalidatePath("/duplicates");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/pending");

  return {
    success: true as const,
    approved,
    skipped,
    dismissedPairs: rows.length,
  };
}
