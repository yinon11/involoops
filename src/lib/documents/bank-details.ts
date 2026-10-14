/**
 * Bank-transfer details printed on outbound documents.
 *
 * Transfer details are payment *instructions*, so they belong only on
 * documents that ask for money. Israeli invoicing practice converges on the
 * same rule: the details belong on the payment-request family — חשבון עסקה /
 * דרישת תשלום and חשבונית מס — and are suppressed on documents that evidence
 * payment already received (חשבונית מס/קבלה, קבלה), where transfer
 * instructions would invite a second payment.
 *
 * `CREDIT_INVOICE` is money flowing the other way and `DELIVERY_NOTE` carries
 * no amounts, so neither prints them either.
 */

import type { DocumentType } from "./types";

/** Document types whose PDF / preview may carry the transfer details. */
export const BANK_DETAILS_DOCUMENT_TYPES: readonly DocumentType[] = [
  "TAX_INVOICE",
  "PROFORMA",
];

/**
 * Renderers default a missing `documentType` to TAX_INVOICE (see
 * `InvoiceData.documentType`), so drafts and template previews follow the
 * TAX_INVOICE rule.
 */
export function documentTypeShowsBankDetails(
  documentType: DocumentType | null | undefined,
): boolean {
  return BANK_DETAILS_DOCUMENT_TYPES.includes(documentType ?? "TAX_INVOICE");
}

/** Issuer-side transfer details, stored per invoice template. */
export interface BankTransferDetails {
  accountHolder?: string | null;
  bankName?: string | null;
  branch?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  swift?: string | null;
  /** Free text, e.g. "נא לציין את מספר המסמך בהעברה". */
  note?: string | null;
}

const LINE_LABELS = {
  he: {
    title: "פרטים להעברה בנקאית",
    accountHolder: "בעל החשבון",
    bankName: "בנק",
    branch: "סניף",
    accountNumber: "מספר חשבון",
    iban: "IBAN",
    swift: "SWIFT",
  },
  en: {
    title: "Bank transfer details",
    accountHolder: "Account holder",
    bankName: "Bank",
    branch: "Branch",
    accountNumber: "Account number",
    iban: "IBAN",
    swift: "SWIFT / BIC",
  },
} as const;

const LINE_ORDER = [
  "accountHolder",
  "bankName",
  "branch",
  "accountNumber",
  "iban",
  "swift",
] as const;

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * True when at least one account field is filled. An enabled toggle with an
 * empty form must not print an empty card, so every renderer gates on this.
 *
 * `note` deliberately does not count: a card headed "bank transfer details"
 * carrying only free text tells the customer nothing about where to pay.
 */
export function hasBankTransferDetails(
  details: BankTransferDetails | null | undefined,
): boolean {
  if (!details) return false;
  return LINE_ORDER.some((key) => clean(details[key]).length > 0);
}

export interface BankTransferBlock {
  title: string;
  lines: Array<{ label: string; value: string }>;
  note: string;
}

/**
 * Label/value pairs for the transfer block, in print order, with empty
 * fields dropped. Returns `null` when there is nothing to print — callers
 * should also check `documentTypeShowsBankDetails` first.
 */
export function buildBankTransferBlock(
  details: BankTransferDetails | null | undefined,
  language: string,
): BankTransferBlock | null {
  if (!hasBankTransferDetails(details)) return null;
  const L = language === "he" ? LINE_LABELS.he : LINE_LABELS.en;
  const lines = LINE_ORDER.map((key) => ({
    label: L[key],
    value: clean(details?.[key]),
  })).filter((line) => line.value.length > 0);
  return { title: L.title, lines, note: clean(details?.note) };
}

/** The `invoice_templates` columns backing the block, as stored. */
export interface BankTransferTemplateColumns {
  bankAccountHolder?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccountNumber?: string | null;
  bankIban?: string | null;
  bankSwift?: string | null;
  bankTransferNote?: string | null;
}

/**
 * Map an `invoice_templates` row onto `BankTransferDetails`. Every
 * `TemplateConfig` assembly site goes through this so the column names stay
 * in one place.
 */
export function bankTransferDetailsFromTemplate(
  template: BankTransferTemplateColumns | null | undefined,
): BankTransferDetails {
  return {
    accountHolder: template?.bankAccountHolder ?? null,
    bankName: template?.bankName ?? null,
    branch: template?.bankBranch ?? null,
    accountNumber: template?.bankAccountNumber ?? null,
    iban: template?.bankIban ?? null,
    swift: template?.bankSwift ?? null,
    note: template?.bankTransferNote ?? null,
  };
}
