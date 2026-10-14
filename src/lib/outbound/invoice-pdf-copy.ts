import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { outboundInvoices } from "@/db/schema";
import { downloadFile, uploadFile } from "@/lib/storage";
import { resolveStorageKeyFromFileUrl } from "@/lib/storage-key";
import { readStoredInvoicePdf } from "@/lib/outbound/stored-invoice-pdf";

/**
 * The מקור file lives at `{userId}/invoices-pdf/{number}.pdf`.
 * The certified copy, frozen at the same time, lives beside it.
 */
export function issuedCopyPdfKey(originalKey: string): string {
  return originalKey.toLowerCase().endsWith(".pdf")
    ? `${originalKey.slice(0, -4)}.copy.pdf`
    : `${originalKey}.copy.pdf`;
}

/**
 * One מקור leaves the system. The first download or email wins it;
 * everyone after that receives the certified copy.
 */
export async function claimOriginalRelease(invoiceId: string): Promise<boolean> {
  const claimed = await db
    .update(outboundInvoices)
    .set({ originalReleasedAt: new Date() })
    .where(
      and(
        eq(outboundInvoices.id, invoiceId),
        isNull(outboundInvoices.originalReleasedAt),
      ),
    )
    .returning({ id: outboundInvoices.id });
  return claimed.length > 0;
}

export async function storeIssuedCopyPdf(
  originalKey: string,
  buffer: Buffer,
): Promise<string> {
  const key = issuedCopyPdfKey(originalKey);
  await uploadFile(buffer, key, "application/pdf");
  return key;
}

export type HandedInvoicePdf =
  | { ok: true; buffer: Buffer; kind: "original" | "copy" }
  | { ok: false; reason: "missing_original" }
  | { ok: false; reason: "missing_copy"; copyKey: string };

/**
 * Hand out the stored PDF. The first caller receives the מקור file and
 * the row remembers that. Later callers receive the העתק נאמן למקור
 * file. A missing copy is reported so the caller can render one without
 * replacing the original.
 */
export async function handOutStoredInvoicePdf(params: {
  invoiceId: string;
  pdfUrl: string | null | undefined;
  ownerUserId: string;
}): Promise<HandedInvoicePdf> {
  const originalKey = params.pdfUrl
    ? resolveStorageKeyFromFileUrl(params.pdfUrl)
    : null;
  const original = await readStoredInvoicePdf({
    pdfUrl: params.pdfUrl,
    ownerUserId: params.ownerUserId,
  });
  if (!original || !originalKey) return { ok: false, reason: "missing_original" };

  const won = await claimOriginalRelease(params.invoiceId);
  if (won) return { ok: true, buffer: original, kind: "original" };

  const copyKey = issuedCopyPdfKey(originalKey);
  if (!copyKey.startsWith(`${params.ownerUserId}/`)) {
    return { ok: false, reason: "missing_copy", copyKey };
  }
  try {
    return { ok: true, buffer: await downloadFile(copyKey), kind: "copy" };
  } catch {
    return { ok: false, reason: "missing_copy", copyKey };
  }
}
