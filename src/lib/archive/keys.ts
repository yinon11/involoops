import type { ArchiveObjectKind } from "@/db/schema/archive-objects";
import type { DocumentType } from "@/lib/documents/types";

/**
 * Deterministic archive-key builder (Spec 05). Pure function so the
 * same (business entity, document, kind) always lands at the same S3
 * key — prevents duplicate writes under concurrent issuance and makes
 * orphan reconciliation trivial (the key is fully recoverable from DB
 * fields).
 *
 * Layout: `{businessEntityId}/{taxYear}/{documentType}/{formattedNumber}/{kind}.{ext}`
 * Example: `3a.../2026/TAX_INVOICE/2026-TI-000042/canonical-json.json`
 */
export function buildArchiveKey(params: {
  businessEntityId: string;
  taxYear: number;
  documentType: DocumentType;
  formattedNumber: string;
  objectKind: ArchiveObjectKind;
}): string {
  const { businessEntityId, taxYear, documentType, formattedNumber, objectKind } =
    params;
  const filename = ARCHIVE_OBJECT_FILE[objectKind];
  return `${businessEntityId}/${taxYear}/${documentType}/${formattedNumber}/${filename}`;
}

export const ARCHIVE_OBJECT_FILE: Record<ArchiveObjectKind, string> = {
  CANONICAL_JSON: "canonical-json.json",
  SIGNATURE: "signature.json",
  PDF: "document.pdf",
  AUDIT_BUNDLE: "audit-bundle.json",
  PDF_FINAL: "document-final.pdf",
  UNIFORM_STRUCTURE_INI: "INI.TXT",
  UNIFORM_STRUCTURE_BKMVDATA: "BKMVDATA.TXT",
  REVERSE_CHARGE_CONSENT: "reverse-charge-consent.pdf",
};

export const ARCHIVE_OBJECT_CONTENT_TYPE: Record<ArchiveObjectKind, string> = {
  CANONICAL_JSON: "application/json",
  SIGNATURE: "application/json",
  PDF: "application/pdf",
  AUDIT_BUNDLE: "application/json",
  PDF_FINAL: "application/pdf",
  UNIFORM_STRUCTURE_INI: "text/plain; charset=windows-1255",
  UNIFORM_STRUCTURE_BKMVDATA: "text/plain; charset=windows-1255",
  REVERSE_CHARGE_CONSENT: "application/pdf",
};
