import type { customers } from "@/db/schema";

type CustomerRow = typeof customers.$inferSelect;

/**
 * Public-API representation of a customer. snake_case JSON; ISO timestamps.
 */
export function serializeCustomer(row: CustomerRow) {
  return {
    object: "customer" as const,
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    tax_id: row.taxId,
    notes: row.notes,
    created_at: row.createdAt?.toISOString() ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
  };
}
