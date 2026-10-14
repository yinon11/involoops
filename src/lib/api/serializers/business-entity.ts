import type { businessEntities } from "@/db/schema";

type Row = typeof businessEntities.$inferSelect;

export function serializeBusinessEntity(row: Row) {
  return {
    object: "business_entity" as const,
    id: row.id,
    legal_name: row.legalName,
    legal_name_en: row.legalNameEn,
    osek_murshe: row.osekMurshe,
    entity_type: row.entityType,
    address: row.address ?? null,
    phone: row.phone,
    email: row.email,
    tax_year_starts_month: row.taxYearStartsMonth,
    default_vat_inclusive: row.defaultVatInclusive,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
