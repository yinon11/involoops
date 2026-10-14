import type { invoiceTemplates } from "@/db/schema";

type Row = typeof invoiceTemplates.$inferSelect;

export function serializeTemplate(row: Row) {
  return {
    object: "invoice_template" as const,
    id: row.id,
    name: row.name,
    design_id: row.designId,
    accent_color: row.accentColor,
    logo_url: row.logoUrl,
    business_phone: row.businessPhone,
    business_email: row.businessEmail,
    business_website: row.businessWebsite,
    show_vat_breakdown: row.showVatBreakdown,
    show_bank_details: row.showBankDetails,
    bank_account_holder: row.bankAccountHolder,
    bank_name: row.bankName,
    bank_branch: row.bankBranch,
    bank_account_number: row.bankAccountNumber,
    bank_iban: row.bankIban,
    bank_swift: row.bankSwift,
    bank_transfer_note: row.bankTransferNote,
    default_currency: row.defaultCurrency,
    default_language: row.defaultLanguage,
    is_default: row.isDefault,
    created_at: row.createdAt?.toISOString() ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
  };
}
