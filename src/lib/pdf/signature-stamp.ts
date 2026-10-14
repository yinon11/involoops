import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documentSignatures } from "@/db/schema";
import type { PdfSignatureStamp } from "./render-invoice-html";

/**
 * Public verification URL prefix used in the PDF signature footer + QR.
 * `NEXT_PUBLIC_APP_URL` is the production hostname (e.g.
 * `https://invoices.example.com`); `APP_URL` is the legacy fallback.
 * Localhost is acceptable in dev — production must set
 * `NEXT_PUBLIC_APP_URL` (see KNOWN_ISSUES §2 "production pre-launch").
 */
export function verifyBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "http://localhost:3000"
  );
}

/**
 * Build the visible signature stamp (signed-at, key id, hash short,
 * verify URL, QR code) drawn at the bottom of every issued PDF.
 *
 * Two construction paths share this helper because the issuance flow
 * has the canonical-hash + keyId in scope **before** persisting the
 * `document_signatures` row, while the finalize / send / on-demand
 * paths need to re-hydrate from the persisted row.
 */
export async function buildPdfSignatureStamp(input: {
  documentId: string;
  signedAt: Date;
  keyId: string;
  canonicalJsonHash: string;
}): Promise<PdfSignatureStamp> {
  const verifyUrl = `${verifyBaseUrl()}/verify/${input.documentId}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1 });
  return {
    signedAt: input.signedAt,
    keyId: input.keyId,
    canonicalJsonHashShort: input.canonicalJsonHash.slice(0, 16),
    verifyUrl,
    qrDataUrl,
  };
}

/**
 * Re-hydrate the stamp from the persisted `document_signatures` row.
 * Returns `null` when the document has not been signed yet (drafts,
 * or issued rows whose signature insertion failed — both are render
 * paths that should produce a footerless PDF).
 */
export async function loadPdfSignatureStamp(
  documentId: string,
): Promise<PdfSignatureStamp | null> {
  const [row] = await db
    .select({
      signedAt: documentSignatures.signedAt,
      keyId: documentSignatures.keyId,
      canonicalJsonHash: documentSignatures.canonicalJsonHash,
    })
    .from(documentSignatures)
    .where(eq(documentSignatures.documentId, documentId))
    .limit(1);
  if (!row) return null;
  return buildPdfSignatureStamp({
    documentId,
    signedAt: row.signedAt,
    keyId: row.keyId,
    canonicalJsonHash: row.canonicalJsonHash,
  });
}
