import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { dismissedDuplicatePairs, invoices, vendors } from "@/db/schema";

export interface DuplicateMember {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  amount: string;
  currency: string | null;
  status: string | null;
}

export interface DuplicateGroupRecord {
  id: string;
  reason: "same_document" | "same_number";
  label: string;
  invoices: DuplicateMember[];
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function asIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    return value.replace(/^\{|\}$/g, "").split(",").map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Same two duplicate rules as the website: same vendor, amount and date,
 * or the same invoice number. Groups the user already dismissed stay hidden.
 */
export async function listDuplicateGroups(userId: string): Promise<DuplicateGroupRecord[]> {
  const vendorKeyExpr = sql<string>`coalesce(${invoices.vendorId}::text, 'suggested:' || lower(btrim(${invoices.suggestedVendorName})))`;
  const numberKeyExpr = sql<string>`btrim(${invoices.invoiceNumber})`;

  const [vendorGroupRows, numberGroupRows] = await Promise.all([
    db
      .select({
        vendorKey: vendorKeyExpr,
        ids: sql<string[]>`array_agg(${invoices.id}::text order by ${invoices.createdAt} desc)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.userId, userId),
          sql`${invoices.invoiceDate} is not null`,
          sql`${invoices.amount} is not null`,
          sql`${invoices.status} <> 'rejected'`,
          sql`(${invoices.vendorId} is not null or btrim(coalesce(${invoices.suggestedVendorName}, '')) <> '')`,
        ),
      )
      .groupBy(vendorKeyExpr, invoices.amount, invoices.invoiceDate)
      .having(sql`count(*) > 1`)
      .orderBy(desc(sql`max(${invoices.createdAt})`)),
    db
      .select({
        invoiceNumber: numberKeyExpr,
        ids: sql<string[]>`array_agg(${invoices.id}::text order by ${invoices.createdAt} desc)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.userId, userId),
          sql`${invoices.status} <> 'rejected'`,
          sql`btrim(coalesce(${invoices.invoiceNumber}, '')) <> ''`,
        ),
      )
      .groupBy(numberKeyExpr)
      .having(sql`count(*) > 1`)
      .orderBy(desc(sql`max(${invoices.createdAt})`)),
  ]);

  const allIds = Array.from(
    new Set([
      ...vendorGroupRows.flatMap((group) => asIds(group.ids)),
      ...numberGroupRows.flatMap((group) => asIds(group.ids)),
    ]),
  );
  if (allIds.length === 0) return [];

  const [dismissedRows, invoiceRows] = await Promise.all([
    db
      .select({
        a: dismissedDuplicatePairs.invoiceIdA,
        b: dismissedDuplicatePairs.invoiceIdB,
      })
      .from(dismissedDuplicatePairs)
      .where(
        and(
          eq(dismissedDuplicatePairs.userId, userId),
          inArray(dismissedDuplicatePairs.invoiceIdA, allIds),
          inArray(dismissedDuplicatePairs.invoiceIdB, allIds),
        ),
      ),
    db
      .select({
        id: invoices.id,
        vendorName: vendors.name,
        suggestedVendorName: invoices.suggestedVendorName,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        amount: invoices.amount,
        currency: invoices.currency,
        status: invoices.status,
      })
      .from(invoices)
      .leftJoin(vendors, and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)))
      .where(and(eq(invoices.userId, userId), inArray(invoices.id, allIds))),
  ]);

  const dismissed = new Set(dismissedRows.map((row) => pairKey(row.a, row.b)));
  const fullyDismissed = (ids: string[]) => {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (!dismissed.has(pairKey(ids[i], ids[j]))) return false;
      }
    }
    return true;
  };

  const byId = new Map(invoiceRows.map((row) => [row.id, row]));
  const membersOf = (ids: string[]): DuplicateMember[] =>
    ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => !!row)
      .map((row) => ({
        id: row.id,
        vendor_name: row.vendorName || row.suggestedVendorName,
        invoice_number: row.invoiceNumber,
        invoice_date: row.invoiceDate,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
      }));

  const seen = new Set<string>();
  const groups: DuplicateGroupRecord[] = [];
  const setKey = (ids: string[]) => [...ids].sort().join(",");

  for (const group of vendorGroupRows) {
    const members = membersOf(asIds(group.ids));
    if (members.length < 2) continue;
    const ids = members.map((member) => member.id);
    const key = setKey(ids);
    seen.add(key);
    if (fullyDismissed(ids)) continue;
    const label =
      members.find((member) => member.vendor_name)?.vendor_name?.trim() || "—";
    groups.push({
      id: ids[0],
      reason: "same_document",
      label,
      invoices: members,
    });
  }

  for (const group of numberGroupRows) {
    const members = membersOf(asIds(group.ids));
    if (members.length < 2) continue;
    const ids = members.map((member) => member.id);
    if (seen.has(setKey(ids)) || fullyDismissed(ids)) continue;
    groups.push({
      id: ids[0],
      reason: "same_number",
      label: group.invoiceNumber,
      invoices: members,
    });
  }

  return groups;
}
