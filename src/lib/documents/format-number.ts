import { DOCUMENT_TYPE_PREFIX, type DocumentType } from "./types";

/** Zero-pad width for the sequence portion of a formatted number. */
export const SEQUENCE_NUMBER_WIDTH = 6;

/**
 * Pure, deterministic formatter for a document's user-visible number.
 * Shape: `{taxYear}-{prefix}-{seq:06d}`, e.g. `2026-TI-000042`.
 *
 * Must stay byte-identical across callers — it is written into
 * `outbound_invoices.formatted_number` and used for PDF rendering, so any
 * drift would be visible as a mismatch between UI and stored data.
 */
export function formatDocumentNumber(
  documentType: DocumentType,
  taxYear: number,
  sequenceNumber: number,
): string {
  if (!Number.isInteger(taxYear) || taxYear < 1000) {
    throw new Error(`formatDocumentNumber: invalid taxYear ${taxYear}`);
  }
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new Error(
      `formatDocumentNumber: invalid sequenceNumber ${sequenceNumber}`,
    );
  }
  const prefix = DOCUMENT_TYPE_PREFIX[documentType];
  const seq = String(sequenceNumber).padStart(SEQUENCE_NUMBER_WIDTH, "0");
  return `${taxYear}-${prefix}-${seq}`;
}
