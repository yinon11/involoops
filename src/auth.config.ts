/**
 * Edge-safe Auth.js slice — imported only by `middleware.ts`.
 * Do not import `@/auth` from middleware: that pulls Node-only code (DB, MFA / node:crypto).
 */
import type { NextAuthConfig } from "next-auth";

// NOT a React hook — the old name (`useSecureCookiesFromEnv`) tripped
// react-hooks/rules-of-hooks, which reads any `use*` identifier as one and
// then objects to it being called at module scope. This reads an env var.
function secureCookiesFromEnv(): boolean {
  const raw = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  if (!raw) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

export const SECURE_COOKIES = secureCookiesFromEnv();

/** Session cookie name — must match `auth.ts` / switch-account decode. */
export const SESSION_COOKIE_NAME = SECURE_COOKIES
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";

/**
 * Strip the `/en/` or `/he/` locale prefix so the rest of the function only
 * has to think about un-prefixed paths. Locale-less paths pass through
 * unchanged. Bare `/en` and `/he` collapse to `/`.
 */
function stripLocalePrefix(pathname: string): string {
  if (pathname === "/en" || pathname === "/he") return "/";
  if (pathname.startsWith("/en/")) return pathname.slice(3);
  if (pathname.startsWith("/he/")) return pathname.slice(3);
  return pathname;
}

function isPublicRoute(pathname: string): boolean {
  // Marketing routes live under `/[locale]/...` after Phase 2; auth /
  // verify / api routes stay at the root because their content is driven
  // by the cookie locale, not the URL. Strip the prefix once at the top
  // so the allowlist below mirrors the un-prefixed slugs.
  const path = stripLocalePrefix(pathname);
  return (
    path === "/" ||
    path === "/privacy" ||
    path === "/terms" ||
    path === "/accessibility" ||
    path === "/license" ||
    // Original ITA registration certificate, linked from the public license page.
    path === "/certificates/involoops-ita-registration.pdf" ||
    path === "/contact" ||
    path === "/learn" ||
    path.startsWith("/learn/") ||
    // Product guide and API reference. English-only, linked from the public
    // footer. The markdown under docs/user-guide is what /developers/guide renders.
    path.startsWith("/developers") ||
    path.startsWith("/login") ||
    path.startsWith("/register") ||
    path.startsWith("/forgot-password") ||
    path.startsWith("/reset-password") ||
    path.startsWith("/verify-email") ||
    path.startsWith("/verify/") ||
    path.startsWith("/invite/") ||
    // Reverse-charge consent: the buyer has no account; the link token is
    // the credential, checked by the page and the sign action.
    path.startsWith("/consent/") ||
    path.startsWith("/api/auth") ||
    path.startsWith("/api/webhooks/ses") ||
    path.startsWith("/api/webhooks/gmail") ||
    path.startsWith("/api/webhooks/stripe") ||
    path.startsWith("/api/cron/") ||
    // Public REST API + MCP — bearer API keys authenticate inside the handlers.
    path.startsWith("/api/v1") ||
    path.startsWith("/api/mcp") ||
    path.startsWith("/.well-known/oauth-protected-resource") ||
    path.startsWith("/.well-known/oauth-authorization-server") ||
    path.startsWith("/.well-known/openid-configuration") ||
    // MCP OAuth (authorization code + token). Consent checks the session itself.
    path.startsWith("/oauth") ||
    // Spec 07: ITA OAuth redirect — browser hits this from openapi.taxes.gov.il without session.
    path.startsWith("/api/shaam/oauth/callback")
  );
}

export const authConfig = {
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  /** Real providers live in `auth.ts`; middleware only needs an empty array here. */
  providers: [],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: SECURE_COOKIES,
      },
    },
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const pathname = nextUrl.pathname;
      // `/api/files/*` handlers authenticate themselves and need to
      // return JSON / image bytes (not an HTML /login redirect) so an
      // unauthenticated `<img>` request fails cleanly instead of
      // confusing the browser with the wrong content type.
      if (pathname.startsWith("/api/files/")) {
        return true;
      }
      if (isPublicRoute(pathname)) {
        return true;
      }
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
