/**
 * Preview URL for the authenticated file stream. Prefer `invoiceId` so the
 * request stays short (no huge encoded URLs in the query string / reverse proxies).
 */
export function invoicePreviewRequestSrc(invoiceId: string): string | null {
  if (!invoiceId?.trim()) return null;
  return `/api/files/preview?invoiceId=${encodeURIComponent(invoiceId.trim())}`;
}
