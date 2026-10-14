import type { TemplateDesignId } from "@/types/template";

/**
 * snake_case → camelCase mapping for the invoice-templates write payload.
 * Shared between POST /invoice-templates and PATCH /invoice-templates/{id}.
 *
 * Issuer identity (name, address, tax ID) has no representation here:
 * it lives on `business_entities` and is set through
 * PATCH /business-entity.
 */
export function mapTemplatePatch(body: Partial<{
  design_id: TemplateDesignId;
  accent_color: string;
  logo_url: string | null;
  business_phone: string | null;
  business_email: string | null;
  business_website: string | null;
  show_vat_breakdown: boolean;
  show_bank_details: boolean;
  bank_account_holder: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account_number: string | null;
  bank_iban: string | null;
  bank_swift: string | null;
  bank_transfer_note: string | null;
  default_currency: string;
  default_language: string;
}>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (body.design_id !== undefined) patch.designId = body.design_id;
  if (body.accent_color !== undefined) patch.accentColor = body.accent_color;
  if (body.logo_url !== undefined) patch.logoUrl = body.logo_url;
  if (body.business_phone !== undefined)
    patch.businessPhone = body.business_phone;
  if (body.business_email !== undefined)
    patch.businessEmail = body.business_email;
  if (body.business_website !== undefined)
    patch.businessWebsite = body.business_website;
  if (body.show_vat_breakdown !== undefined)
    patch.showVatBreakdown = body.show_vat_breakdown;
  if (body.show_bank_details !== undefined)
    patch.showBankDetails = body.show_bank_details;
  if (body.bank_account_holder !== undefined)
    patch.bankAccountHolder = body.bank_account_holder;
  if (body.bank_name !== undefined) patch.bankName = body.bank_name;
  if (body.bank_branch !== undefined) patch.bankBranch = body.bank_branch;
  if (body.bank_account_number !== undefined)
    patch.bankAccountNumber = body.bank_account_number;
  if (body.bank_iban !== undefined) patch.bankIban = body.bank_iban;
  if (body.bank_swift !== undefined) patch.bankSwift = body.bank_swift;
  if (body.bank_transfer_note !== undefined)
    patch.bankTransferNote = body.bank_transfer_note;
  if (body.default_currency !== undefined)
    patch.defaultCurrency = body.default_currency;
  if (body.default_language !== undefined)
    patch.defaultLanguage = body.default_language;
  return patch;
}
