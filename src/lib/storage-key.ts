/**
 * Stored `file_url` is either the raw S3 key (`userId/year/month/file.pdf`)
 * or a legacy full URL — extract the object key for MinIO path-style URLs.
 */
export function resolveStorageKeyFromFileUrl(stored: string): string | null {
  const t = stored.trim();
  if (!t) return null;
  if (!t.includes("://")) return t;
  try {
    const u = new URL(t);
    let path = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    const bucket = process.env.S3_BUCKET || "invoices";
    if (path.startsWith(`${bucket}/`)) {
      path = path.slice(bucket.length + 1);
    }
    return path || null;
  } catch {
    return null;
  }
}
