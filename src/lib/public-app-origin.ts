/**
 * Browser-facing origin for redirects when the app sits behind a TLS-terminating
 * reverse proxy. `request.url` is often `http://localhost:3000/...` internally;
 * `AUTH_URL` / `NEXTAUTH_URL` carry the public hostname (same idea as
 * `getPublicOrigin` in `src/app/api/shaam/oauth/callback/route.ts`).
 */
export function getPublicAppOrigin(request: Request): string {
  for (const raw of [process.env.AUTH_URL, process.env.NEXTAUTH_URL]) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    try {
      return new URL(trimmed).origin;
    } catch {
      /* try next */
    }
  }
  return new URL(request.url).origin;
}
