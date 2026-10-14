/**
 * Canonical document representation for digital signatures (Spec 04).
 *
 * The function here is pure and deterministic: given the same set of
 * inputs, it returns byte-identical JSON once passed through
 * `canonicalJson`. Any drift in this function permanently invalidates
 * every pre-existing signature, so changes here must bump
 * `schemaVersion` and the `documentSignatures.version` default in the
 * migration that follows.
 *
 * Fields are flat, no denormalised relationships. Optional fields
 * (address components) are omitted rather than serialised as `null` so
 * the set of keys is minimal — reducing accidental surface for
 * canonicalisation drift.
 */

import { formatMoney } from "@/lib/money";
import type { DocumentType } from "@/lib/documents/types";
import type { OutboundLineItem } from "@/db/schema/outbound-invoices";
import type { BusinessEntityAddress } from "@/db/schema/business-entities";

export const CANONICAL_DOCUMENT_SCHEMA_VERSION = 1 as const;

export interface CanonicalDocument {
  schemaVersion: typeof CANONICAL_DOCUMENT_SCHEMA_VERSION;
  documentId: string;
  documentType: DocumentType;
  formattedNumber: string;
  sequenceNumber: number;
  taxYear: number;
  issueDate: string;
  /**
   * Value or payment date the user entered, when it differs from
   * `issueDate`. Omitted when they are the same, and omitted on
   * documents signed before this field existed.
   */
  valueDate?: string;
  /**
   * Reverse charge (היפוך חיוב): issued at zero VAT because the buyer
   * self-reports it. Present only when true, so every document signed
   * before this field existed — and every ordinary one after — produces
   * byte-identical JSON and needs no schema-version bump.
   */
  reverseCharge?: true;
  businessEntity: {
    id: string;
    legalName: string;
    osekMurshe: string | null;
    entityType: string;
    address: CanonicalAddress;
  };
  customer: {
    id: string | null;
    name: string;
    osekMurshe: string | null;
    address: CanonicalAddress;
  };
  lines: CanonicalLine[];
  totals: {
    subtotal: string;
    vatTotal: string;
    grandTotal: string;
    currency: string;
  };
  metadata: {
    createdAt: string;
    createdByUserId: string;
  };
  /**
   * Populated ONLY for credit notes (Spec 06). Captures a snapshot of
   * the original invoice at signing time so the credit note's signature
   * stays verifiable even if the original is later rotated or
   * tampered with. `canonicalJsonHash` is included so a recipient can
   * anchor the credit to a specific integrity digest of the original.
   */
  reference?: {
    documentId: string;
    formattedNumber: string;
    issueDate: string;
    grandTotal: string;
    canonicalJsonHash: string;
  };
}

export type CanonicalAddress = Partial<
  Record<"street" | "city" | "zip" | "country", string>
>;

export interface CanonicalLine {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  vatRate: string;
  vatAmount: string;
}

export interface BuildCanonicalInput {
  invoice: {
    id: string;
    documentType: DocumentType;
    formattedNumber: string;
    sequenceNumber: number;
    taxYear: number;
    invoiceDate: string;
    /** Israel civil day printed on the document. Null until issue. */
    printedDate?: string | null;
    items: OutboundLineItem[];
    subtotal: string | number;
    vatRate: string | number | null;
    vatAmount: string | number | null;
    total: string | number;
    currency: string | null;
    userId: string;
    createdAt: Date | string | null;
    reverseCharge?: boolean | null;
  };
  businessEntity: {
    id: string;
    legalName: string;
    osekMurshe: string | null;
    entityType: string;
    address: BusinessEntityAddress | null;
  };
  customer: {
    id: string;
    name: string;
    taxId: string | null;
    address: string | null;
  } | null;
  /** Populated for credit notes; see `CanonicalDocument.reference`. */
  reference?: {
    documentId: string;
    formattedNumber: string;
    issueDate: string;
    grandTotal: string | number;
    canonicalJsonHash: string;
  };
}

export function buildCanonicalDocument(
  input: BuildCanonicalInput,
): CanonicalDocument {
  const { invoice, businessEntity, customer } = input;

  const vatRate = invoice.vatRate ?? 0;
  const lines: CanonicalLine[] = invoice.items.map((item) => {
    const lineTotal = item.quantity * item.unitPrice;
    const lineVat =
      Math.round(lineTotal * (Number(vatRate) / 100) * 100) / 100;
    return {
      description: item.description,
      quantity: formatMoney(item.quantity),
      unitPrice: formatMoney(item.unitPrice),
      lineTotal: formatMoney(lineTotal),
      vatRate: formatMoney(vatRate),
      vatAmount: formatMoney(lineVat),
    };
  });

  const createdAtIso =
    invoice.createdAt === null || invoice.createdAt === undefined
      ? new Date(0).toISOString()
      : new Date(invoice.createdAt).toISOString();

  const documentDate = invoice.printedDate ?? invoice.invoiceDate;
  const issueDate = new Date(`${documentDate}T00:00:00Z`).toISOString();
  const valueDate =
    invoice.printedDate && invoice.printedDate !== invoice.invoiceDate
      ? new Date(`${invoice.invoiceDate}T00:00:00Z`).toISOString()
      : undefined;

  const result: CanonicalDocument = {
    schemaVersion: CANONICAL_DOCUMENT_SCHEMA_VERSION,
    documentId: invoice.id,
    documentType: invoice.documentType,
    formattedNumber: invoice.formattedNumber,
    sequenceNumber: invoice.sequenceNumber,
    taxYear: invoice.taxYear,
    issueDate,
    ...(valueDate ? { valueDate } : {}),
    ...(invoice.reverseCharge ? { reverseCharge: true as const } : {}),
    businessEntity: {
      id: businessEntity.id,
      legalName: businessEntity.legalName,
      osekMurshe: businessEntity.osekMurshe,
      entityType: businessEntity.entityType,
      address: normaliseBusinessAddress(businessEntity.address),
    },
    customer: customer
      ? {
          id: customer.id,
          name: customer.name,
          osekMurshe: customer.taxId,
          address: normaliseCustomerAddress(customer.address),
        }
      : {
          id: null,
          name: "",
          osekMurshe: null,
          address: {},
        },
    lines,
    totals: {
      subtotal: formatMoney(invoice.subtotal),
      vatTotal: formatMoney(invoice.vatAmount ?? 0),
      grandTotal: formatMoney(invoice.total),
      currency: invoice.currency ?? "ILS",
    },
    metadata: {
      createdAt: createdAtIso,
      createdByUserId: invoice.userId,
    },
  };

  if (input.reference) {
    result.reference = {
      documentId: input.reference.documentId,
      formattedNumber: input.reference.formattedNumber,
      issueDate: input.reference.issueDate,
      grandTotal: formatMoney(input.reference.grandTotal),
      canonicalJsonHash: input.reference.canonicalJsonHash,
    };
  }

  return result;
}

function normaliseBusinessAddress(
  addr: BusinessEntityAddress | null,
): CanonicalAddress {
  if (!addr) return {};
  const out: CanonicalAddress = {};
  if (addr.street) out.street = addr.street;
  if (addr.city) out.city = addr.city;
  if (addr.zip) out.zip = addr.zip;
  if (addr.country) out.country = addr.country;
  return out;
}

/**
 * The `customers` table stores address as a single free-text column.
 * We map it to `street` inside the canonical address so the schema
 * stays uniform; if the structured-address migration lands later, this
 * function grows a branch without changing the canonical shape.
 */
function normaliseCustomerAddress(addr: string | null): CanonicalAddress {
  if (!addr) return {};
  return { street: addr };
}
