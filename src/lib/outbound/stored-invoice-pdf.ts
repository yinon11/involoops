import { downloadFile } from "@/lib/storage";
import { resolveStorageKeyFromFileUrl } from "@/lib/storage-key";

/**
 * The customer-facing PDF written when the document was issued (and
 * replaced only when an allocation number arrives and the final PDF is
 * archived). Downloads and email attachments serve this file. A missing
 * object returns null so the caller can render once and store it.
 */
export async function readStoredInvoicePdf(params: {
  pdfUrl: string | null | undefined;
  ownerUserId: string;
}): Promise<Buffer | null> {
  if (!params.pdfUrl) return null;
  const key = resolveStorageKeyFromFileUrl(params.pdfUrl);
  if (!key || !key.startsWith(`${params.ownerUserId}/`)) return null;
  try {
    return await downloadFile(key);
  } catch (err) {
    console.error(
      "[invoice-pdf] stored file unavailable:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
