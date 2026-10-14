import type { DocumentType } from "@/lib/documents/types";
import type { BankTransferDetails } from "@/lib/documents/bank-details";
import type { PaymentEntry } from "@/lib/documents/payments";
import type { ForeignExchangeDisplay } from "@/lib/outbound/foreign-exchange-display";

/**
 * Single source of truth for available invoice template designs.
 *
 * Adding a new design requires:
 *   1. Append the id here.
 *   2. Add a React renderer at
 *      `src/components/templates/renderers/<id>-template.tsx`
 *      and register it in `template-preview.tsx`.
 *   3. Add a PDF (HTML) renderer in
 *      `src/lib/pdf/render-invoice-html.ts` and register it in the
 *      `RENDERERS` switch there.
 *   4. Provide an English + Hebrew label below.
 *
 * Stored in `invoice_templates.design_id` (TEXT). Existing rows always
 * carry one of these ids; `coerceDesignId` falls back to "classic"
 * for unknown values to keep older / hand-edited rows safe.
 */
export const TEMPLATE_DESIGN_IDS = [
  "classic",
  "modern",
  "minimal",
  "bold",
  "compact",
] as const;

export type TemplateDesignId = (typeof TEMPLATE_DESIGN_IDS)[number];

export const TEMPLATE_DESIGN_LABELS: Record<
  TemplateDesignId,
  {
    en: string;
    he: string;
    description: string;
    descriptionHe: string;
  }
> = {
  classic: {
    en: "Classic",
    he: "קלאסי",
    description: "Bordered header, accent-coloured table heading, formal feel.",
    descriptionHe:
      "כותרת ממוסגרת, כותרת טבלה בצבע מודגש, תחושה רשמית.",
  },
  modern: {
    en: "Modern",
    he: "מודרני",
    description: "Soft cards, accent bar at the top, friendly two-column info.",
    descriptionHe:
      "כרטיסיות רכות, פס מודגש בראש העמוד, פריסה דו-טורית ידידותית.",
  },
  minimal: {
    en: "Minimal",
    he: "מינימליסטי",
    description: "Loads of whitespace, monochrome with a single accent line.",
    descriptionHe:
      "המון רווח לבן, מונוכרום עם קו צבע מודגש בודד.",
  },
  bold: {
    en: "Bold",
    he: "נועז",
    description: "Reversed-out accent header, all-caps section titles.",
    descriptionHe:
      "כותרת בולטת על רקע מודגש, כותרות אזור באותיות גדולות.",
  },
  compact: {
    en: "Compact",
    he: "צפוף",
    description: "Dense layout that fits many line items on one page.",
    descriptionHe:
      "פריסה צפופה שמתאימה למספר רב של שורות בעמוד אחד.",
  },
};

export function isTemplateDesignId(value: unknown): value is TemplateDesignId {
  return (
    typeof value === "string" &&
    (TEMPLATE_DESIGN_IDS as readonly string[]).includes(value)
  );
}

/**
 * Coerce any string (typically `invoice_templates.design_id`) to a
 * known design id, defaulting to `classic` for nullish or unknown
 * values. Use this at the boundary where you read the column.
 */
export function coerceDesignId(value: unknown): TemplateDesignId {
  return isTemplateDesignId(value) ? value : "classic";
}

export interface TemplateConfig {
  designId: TemplateDesignId;
  accentColor: string;
  logoUrl?: string | null;
  businessName?: string;
  businessAddress?: string;
  businessPhone?: string;
  businessEmail?: string;
  businessTaxId?: string;
  businessWebsite?: string;
  showVatBreakdown: boolean;
  /**
   * Master switch for the bank-transfer block. Even when on, the block only
   * prints on document types the ITA / market rule allows — see
   * `BANK_DETAILS_DOCUMENT_TYPES` in `@/lib/documents/bank-details`.
   */
  showBankDetails?: boolean;
  /** Issuer bank details backing that block. */
  bankDetails?: BankTransferDetails | null;
  defaultCurrency: string;
  defaultLanguage: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceData {
  invoiceNumber: string;
    invoiceDate: string;
    /** Value or payment date, shown when it differs from the printed issue date. */
    valueDate?: string;
  dueDate?: string;
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  customerTaxId?: string;
  items: InvoiceLineItem[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  currency: string;
  language: string;
  notes?: string;
  /** Spec 08 — ITA allocation number, printed prominently when present. */
  allocationNumber?: string | null;
  /**
   * Spec 08+ — the ITA refused an allocation number and the seller chose
   * to issue anyway. The printed document must say so: the buyer cannot
   * deduct input VAT against it, and they should learn that from the
   * invoice rather than from their accountant months later.
   */
  issuedWithoutAllocation?: boolean;
  /**
   * Reverse charge (היפוך חיוב): zero VAT, the buyer self-reports it. The
   * printout must carry `REVERSE_CHARGE_CAPTION` (ITA v2.0 spec §2.2.2).
   */
  reverseCharge?: boolean;
  /**
   * ILS per 1 unit of `currency`, frozen when the document was issued. The
   * printed ILS figures use it; absent on drafts, which show today's rate.
   */
  fxRateToIls?: number | string | null;
  /**
   * Issued by a sandboxed business entity. The PDF and on-screen
   * preview print `SANDBOX_DOCUMENT_MARK`.
   */
  sandbox?: boolean;
  /**
   * ITA rule (חוק מע"מ, ניהול פנקסי חשבונות): the document's legal
   * type dictates the mandatory Hebrew heading — "חשבונית מס",
   * "חשבונית מס / קבלה", "קבלה", "חשבונית זיכוי". When omitted the
   * template falls back to TAX_INVOICE.
   */
  documentType?: DocumentType;
  /**
   * ITA rule: the first PDF handed out is marked "מקור". Every later
   * download or resend is marked "העתק נאמן למקור". Omit for draft
   * previews — the draft watermark handles that case.
   */
  copyMarker?: "original" | "copy" | null;
  /**
   * Spec 11.1 — payment entries. Required on TAX_INVOICE_RECEIPT /
   * RECEIPT, forbidden on everything else. Renderer skips the
   * payment block silently when empty.
   */
  payments?: PaymentEntry[];
  /**
   * When `currency` is foreign (e.g. USD), line items use that currency and
   * the totals footer shows `rate` plus ILS subtotal / VAT / total.
   */
  foreignExchange?: ForeignExchangeDisplay;
}

export interface TemplateRendererProps {
  config: TemplateConfig;
  invoice: InvoiceData;
}
