"use server";

import { db } from "@/db";
import { customers, outboundInvoices } from "@/db/schema";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { requireActorUserId as requireUserId } from "@/lib/team/enforce";

export async function getCustomers() {
  const userId = await requireUserId("view_customers");
  return db
    .select()
    .from(customers)
    .where(eq(customers.userId, userId))
    .orderBy(customers.name);
}

/**
 * Customers with per-record invoice counts and lifetime-invoiced totals.
 * Counts include drafts but exclude soft-deleted rows. Totals are summed in
 * the customer's most recent currency — we intentionally don't convert FX
 * here; the list view shows both total and count next to each customer.
 */
export async function getCustomersWithStats() {
  const userId = await requireUserId("view_customers");
  const entity = await getBusinessEntityForUserOrNull(userId);

  // Without a business entity there are no outbound invoices either,
  // so the per-customer counts and lifetime totals are all zero. We
  // still return the user's customer list (customers are scoped to
  // user, not entity) so first-time users can populate their CRM
  // before issuing their first invoice.
  if (!entity) {
    const rows = await db
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        address: customers.address,
        taxId: customers.taxId,
        notes: customers.notes,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(eq(customers.userId, userId))
      .orderBy(customers.name);
    return rows.map((r) => ({
      ...r,
      invoiceCount: 0,
      lifetimeTotal: "0",
    }));
  }

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      address: customers.address,
      taxId: customers.taxId,
      notes: customers.notes,
      createdAt: customers.createdAt,
      invoiceCount: sql<number>`count(${outboundInvoices.id})::int`,
      lifetimeTotal: sql<string>`coalesce(sum(${outboundInvoices.total}), 0)`,
    })
    .from(customers)
    .leftJoin(
      outboundInvoices,
      and(
        eq(outboundInvoices.customerId, customers.id),
        eq(outboundInvoices.businessEntityId, entity.id),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .where(eq(customers.userId, userId))
    .groupBy(customers.id)
    .orderBy(customers.name);
  return rows;
}

/**
 * Outbound invoices issued to a given customer. Scoped to the caller's
 * business entity so RBAC matches `getOutboundInvoices`. Soft-deleted
 * rows are excluded.
 */
export async function getCustomerInvoices(customerId: string) {
  const userId = await requireUserId("view_customers");
  const entity = await getBusinessEntityForUserOrNull(userId);
  // No entity → no invoices. Skip the join and short-circuit to [].
  if (!entity) return [];

  const owner = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.userId, userId)))
    .limit(1);
  if (owner.length === 0) return [];

  return db
    .select({
      id: outboundInvoices.id,
      formattedNumber: outboundInvoices.formattedNumber,
      documentType: outboundInvoices.documentType,
      invoiceDate: outboundInvoices.invoiceDate,
      total: outboundInvoices.total,
      currency: outboundInvoices.currency,
      status: outboundInvoices.status,
      shaamStatus: outboundInvoices.shaamStatus,
      createdAt: outboundInvoices.createdAt,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.customerId, customerId),
        eq(outboundInvoices.businessEntityId, entity.id),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .orderBy(desc(outboundInvoices.createdAt));
}

export async function getCustomerById(id: string) {
  const userId = await requireUserId("view_customers");
  const row = await db.query.customers.findFirst({
    where: and(eq(customers.id, id), eq(customers.userId, userId)),
  });
  return row ?? null;
}

export async function createCustomer(data: {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  notes?: string;
}) {
  const userId = await requireUserId("manage_customers");
  const [row] = await db
    .insert(customers)
    .values({ ...data, userId })
    .returning();
  revalidatePath("/outbound");
  revalidatePath("/customers");
  return row;
}

export async function updateCustomer(
  id: string,
  data: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    taxId?: string;
    notes?: string;
  }
) {
  const userId = await requireUserId("manage_customers");
  const [row] = await db
    .update(customers)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.userId, userId)))
    .returning();
  revalidatePath("/outbound");
  revalidatePath("/customers");
  return row;
}

export async function deleteCustomer(id: string) {
  const userId = await requireUserId("manage_customers");
  await db
    .delete(customers)
    .where(and(eq(customers.id, id), eq(customers.userId, userId)));
  revalidatePath("/outbound");
  revalidatePath("/customers");
}

/**
 * Set the customer's "auto-send invoices" delivery preference.
 *
 *   null  → prompt on every issuance (default)
 *   true  → auto-email the PDF right after issuance
 *   false → never auto-email; sending stays a manual action
 *
 * Used both by the post-issue "Send to customer?" dialog (via its
 * "remember for this customer" checkbox) and by the delivery
 * preference card on the invoice detail page.
 */
export async function setCustomerAutoSendPreference(
  id: string,
  value: boolean | null,
) {
  const userId = await requireUserId("manage_customers");
  const [row] = await db
    .update(customers)
    .set({ autoSendInvoices: value, updatedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.userId, userId)))
    .returning({
      id: customers.id,
      autoSendInvoices: customers.autoSendInvoices,
    });
  if (!row) throw new Error("Customer not found");
  revalidatePath("/outbound");
  revalidatePath("/customers");
  return row;
}
