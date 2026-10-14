import { oauthRedirectUris } from "@/lib/oauth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local stand-in for Claude's callback. Registered only when
 * `OAUTH_DEV_REDIRECT_URIS` includes this URL. Shows the authorization code
 * so a test client can exchange it. Not used by Claude.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const self = `${url.origin}/oauth/dev-callback`;
  if (!oauthRedirectUris().includes(self) && !oauthRedirectUris().some((uri) => {
    try {
      return new URL(uri).pathname === "/oauth/dev-callback";
    } catch {
      return false;
    }
  })) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const error = url.searchParams.get("error") ?? "";
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>OAuth dev callback</title></head>
<body>
  <p id="error">${escapeHtml(error)}</p>
  <p id="code">${escapeHtml(code)}</p>
  <p id="state">${escapeHtml(state)}</p>
</body></html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
