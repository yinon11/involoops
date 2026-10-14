import { detectMimeFromBytes, sanitizeFilename } from "@/lib/file-validation";
import { downloadFile } from "@/lib/storage";

export const WITHHOLDING_CERTIFICATE_MAX_BYTES = 5 * 1024 * 1024;

/** Stable object key. Replacing the certificate overwrites this object. */
export function withholdingCertificateObjectKey(ownerUserId: string): string {
  return `${ownerUserId}/certificates/withholding-tax.pdf`;
}

export function isWithholdingCertificateExpired(
  validUntil: string | null | undefined,
  today: string,
): boolean {
  return Boolean(validUntil && validUntil < today);
}

export function assertWithholdingCertificatePdf(
  buffer: Buffer,
): "empty" | "not_pdf" | "too_large" | null {
  if (buffer.length === 0) return "empty";
  if (buffer.length > WITHHOLDING_CERTIFICATE_MAX_BYTES) return "too_large";
  if (detectMimeFromBytes(buffer) !== "application/pdf") return "not_pdf";
  return null;
}

export function certificateDownloadName(filename: string | null | undefined): string {
  const cleaned = sanitizeFilename(filename || "ishur-nikuy-mas.pdf");
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

/**
 * Read the saved certificate only when the stored key is the canonical
 * object for this owner. A mismatched key is treated as missing.
 */
export async function readWithholdingCertificate(entity: {
  ownerUserId: string;
  withholdingCertificateKey: string | null;
  withholdingCertificateFilename: string | null;
}): Promise<{ filename: string; content: Buffer } | null> {
  const expected = withholdingCertificateObjectKey(entity.ownerUserId);
  if (!entity.withholdingCertificateKey || entity.withholdingCertificateKey !== expected) {
    return null;
  }
  const content = await downloadFile(expected);
  return {
    filename: certificateDownloadName(entity.withholdingCertificateFilename),
    content,
  };
}
