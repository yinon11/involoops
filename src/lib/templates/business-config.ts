/**
 * Single place where an `invoice_templates` row and a business entity
 * are combined into the `TemplateConfig` the renderers consume.
 *
 * The split is deliberate and load-bearing:
 *
 *   - **Issuer identity** (`businessName`, `businessAddress`,
 *     `businessTaxId`) always comes from `IssuerIdentity` — the live
 *     `business_entities` row for drafts, the signed canonical JSON for
 *     issued documents. `invoice_templates` carries no identity columns
 *     at all — the ones that used to shadow it were dropped in 0039.
 *     See `src/lib/documents/issuer-identity.ts`.
 *   - **Contact details** (`businessPhone`, `businessEmail`,
 *     `businessWebsite`) are presentational, not ITA-mandated, and the
 *     template is their only source. Whatever it holds is printed, and
 *     blank prints nothing — so a tenant can leave the phone off their
 *     invoices entirely, or print `billing@` instead of the registered
 *     address. The template editor seeds these from the business entity
 *     when they have never been set, so the common case needs no typing;
 *     nothing is inherited at render time.
 *
 * Before this helper existed the same twelve lines were copy-pasted
 * across six render paths and had already drifted in a seventh
 * (credit notes read contacts off the entity and dropped the website).
 * Every path now builds its config here so they cannot diverge again.
 */

import type { IssuerIdentity } from "@/lib/documents/issuer-identity";
import {
  bankTransferDetailsFromTemplate,
  type BankTransferTemplateColumns,
} from "@/lib/documents/bank-details";
import { coerceDesignId, type TemplateConfig } from "@/types/template";

export const DEFAULT_ACCENT_COLOR = "#6366f1";
export const DEFAULT_TEMPLATE_CURRENCY = "ILS";
export const DEFAULT_TEMPLATE_LANGUAGE = "he";

/**
 * The branding-only subset of an `invoice_templates` row. Deliberately
 * excludes `businessName` / `businessAddress` / `businessTaxId` so a
 * caller cannot accidentally feed template identity into a rendered
 * document.
 */
export interface TemplateBrandingSource extends BankTransferTemplateColumns {
  designId?: string | null;
  accentColor?: string | null;
  businessPhone?: string | null;
  businessEmail?: string | null;
  businessWebsite?: string | null;
  showVatBreakdown?: boolean | null;
  showBankDetails?: boolean | null;
  defaultCurrency?: string | null;
  defaultLanguage?: string | null;
}

export interface BusinessContact {
  businessPhone: string;
  businessEmail: string;
  businessWebsite: string;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Resolve the contact block printed under the issuer identity. The
 * template is taken literally: a blank field prints nothing, which is
 * how a tenant opts out of showing a phone or email at all.
 */
export function resolveBusinessContact(
  template: TemplateBrandingSource | null | undefined,
): BusinessContact {
  return {
    businessPhone: clean(template?.businessPhone),
    businessEmail: clean(template?.businessEmail),
    businessWebsite: clean(template?.businessWebsite),
  };
}

export interface BuildTemplateConfigInput {
  /** Branding row, or null when the tenant has not saved a template yet. */
  template: TemplateBrandingSource | null | undefined;
  /** Entity-sourced (draft) or canonical-sourced (issued) identity. */
  issuer: IssuerIdentity;
  /** Already-resolved logo (presigned URL or data: URL), or null. */
  logoUrl: string | null;
}

export function buildTemplateConfig({
  template,
  issuer,
  logoUrl,
}: BuildTemplateConfigInput): TemplateConfig {
  const contact = resolveBusinessContact(template);

  return {
    designId: coerceDesignId(template?.designId),
    accentColor: template?.accentColor ?? DEFAULT_ACCENT_COLOR,
    logoUrl,
    // Identity — entity / signed canonical only, never the template.
    businessName: issuer.name,
    businessAddress: issuer.address,
    businessTaxId: issuer.taxId ?? "",
    ...contact,
    showVatBreakdown: template?.showVatBreakdown ?? true,
    showBankDetails: template?.showBankDetails ?? false,
    bankDetails: bankTransferDetailsFromTemplate(template),
    defaultCurrency: template?.defaultCurrency ?? DEFAULT_TEMPLATE_CURRENCY,
    defaultLanguage: template?.defaultLanguage ?? DEFAULT_TEMPLATE_LANGUAGE,
  };
}
