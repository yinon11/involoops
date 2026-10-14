import type { vendors } from "@/db/schema";

type Row = typeof vendors.$inferSelect;

export function serializeVendor(row: Row) {
  return {
    object: "vendor" as const,
    id: row.id,
    name: row.name,
    aliases: row.aliases ?? [],
    default_category: row.defaultCategory,
    is_income_source: row.isIncomeSource ?? false,
    auto_approve: row.autoApprove ?? false,
    website_url: row.websiteUrl,
    website_url_2: row.websiteUrl2,
    tracking_excluded: row.trackingExcluded ?? false,
    created_at: row.createdAt?.toISOString() ?? null,
  };
}
