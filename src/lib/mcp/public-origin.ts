/**
 * Public-facing origin for absolute URLs in auth challenges / metadata.
 * Prefers reverse-proxy forwarding headers when present.
 */
export function getPublicOrigin(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedHost && forwardedProto) {
    return `${forwardedProto}://${forwardedHost.split(",")[0]!.trim()}`;
  }
  return new URL(req.url).origin;
}
