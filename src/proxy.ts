import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, SECURE_COOKIES } from "@/auth.config";
import { MODE_COOKIE_NAME, type AppMode } from "@/lib/mode";
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_EXPLICIT_COOKIE,
  type Locale,
} from "@/lib/i18n/config";

/**
 * Marketing routes that should be served under `/en/...` and `/he/...` for
 * proper hreflang. Anything not matched here (auth, app, api, /verify,
 * /developers — which is intentionally English-only — and Next.js special
 * files) is left untouched by the locale router.
 *
 * Order matters: longer prefixes first, so `/learn/foo` matches before `/`.
 */
const LOCALIZED_PUBLIC_PREFIXES = [
  "/learn",
  "/contact",
  "/accessibility",
  "/license",
  "/privacy",
  "/terms",
];

function isLocalizedPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  for (const prefix of LOCALIZED_PUBLIC_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/**
 * Returns the locale prefix at the start of the path, or `null` if the path
 * doesn't start with a known locale segment. Stripped via `pathname.slice(3)`
 * (length of `/en` / `/he`) so callers can read the un-prefixed remainder.
 */
function readLocalePrefix(pathname: string): Locale | null {
  // `/en` and `/he` (no trailing slash) are valid landing pages.
  if (pathname === "/en" || pathname === "/he") {
    return pathname.slice(1) as Locale;
  }
  if (pathname.startsWith("/en/")) return "en";
  if (pathname.startsWith("/he/")) return "he";
  return null;
}

function detectLocale(req: NextRequest): Locale {
  // Cookie wins — the user's saved or freshly-picked language. We don't read
  // the auth session here because the proxy runs Edge-side and DB calls are
  // disallowed; the cookie is the cheap proxy that gets refreshed by the
  // language switcher and the sign-in event.
  const cookie = req.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;

  const country = req.headers.get("cf-ipcountry");
  if (country) {
    const upper = country.toUpperCase();
    if (upper !== "XX" && upper !== "T1") {
      return upper === "IL" ? "he" : "en";
    }
  }

  const al = req.headers.get("accept-language");
  if (al) {
    const first = al.split(",")[0]?.trim().split(";")[0]?.trim().toLowerCase();
    const primary = first?.split("-")[0];
    if (primary === "he") return "he";
  }

  return defaultLocale;
}

/**
 * CORS for the public REST API (`/api/v1/*`).
 *
 * The API authenticates with bearer tokens only — no cookies, no
 * credentialed sessions — so opening it to any origin matches what
 * Stripe / Anthropic / GitHub do for their public APIs and is safe.
 *
 * Browser-side consumers (Swagger UI's "Try it out" panel served from
 * a different host, customers' SPAs, internal tooling on different
 * subdomains) all need this. cURL doesn't enforce CORS, which is why
 * a request that fails in Swagger UI succeeds from the terminal.
 *
 * `Allow-Origin: *` is incompatible with `Allow-Credentials: true`,
 * which is fine — we don't want browsers attaching session cookies to
 * API requests anyway.
 */
const API_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "access-control-allow-headers":
    "Authorization, Content-Type, Idempotency-Key, X-Request-Id, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID",
  // Headers the browser is allowed to surface to JS callers — request id
  // and rate-limit hints are useful for client-side debugging / backoff.
  "access-control-expose-headers":
    "X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, Mcp-Session-Id",
  "access-control-max-age": "86400",
};

function isPublicApi(pathname: string): boolean {
  return (
    pathname.startsWith("/api/v1/") ||
    pathname === "/api/v1" ||
    pathname.startsWith("/api/mcp") ||
    pathname.startsWith("/.well-known/oauth-protected-resource")
  );
}

function applyApiCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(API_CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

/**
 * Short-circuit CORS preflights before they hit Auth.js — preflights
 * never carry credentials, so running them through the session
 * the proxy would either 401 them or redirect to /login (HTML), both
 * of which the browser interprets as a CORS failure.
 */
function handleApiPreflight(req: NextRequest): NextResponse | null {
  if (req.method !== "OPTIONS") return null;
  if (!isPublicApi(req.nextUrl.pathname)) return null;
  return applyApiCors(new NextResponse(null, { status: 204 }));
}

/**
 * Map URL to shell mode so `readMode()` in the app layout matches deep links.
 * Must stay in sync with `(app)/layout.tsx` shells — cookie is set here because
 * `cookies().set` is not allowed in Server Components (only Actions / Route Handlers / Proxy).
 */
function modeForPathname(pathname: string): AppMode | null {
  if (pathname === "/") return "expense";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/settings/ita-integration")) return "creator";
  // `/settings/api-keys` and `/developers` serve BOTH modes — the public REST
  // API exposes scopes for expense and creator domains, and either kind of
  // user may want to mint a key. Return `null` so the proxy leaves the
  // mode cookie alone and `router.refresh()` after the create/revoke action
  // doesn't yank a creator-mode user back into the expense shell.
  if (
    pathname.startsWith("/settings/api-keys") ||
    pathname.startsWith("/developers")
  ) {
    return null;
  }
  if (
    pathname.startsWith("/outbound") ||
    pathname.startsWith("/customers") ||
    pathname.startsWith("/projects")
  ) {
    return "creator";
  }
  if (
    pathname.startsWith("/money-in") ||
    pathname.startsWith("/money-out") ||
    pathname.startsWith("/clients")
  ) {
    return "expense";
  }
  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/invoices") ||
    pathname.startsWith("/vendors") ||
    pathname.startsWith("/income") ||
    pathname.startsWith("/profit") ||
    pathname.startsWith("/pending") ||
    pathname.startsWith("/duplicates") ||
    pathname.startsWith("/export") ||
    pathname.startsWith("/tutorials") ||
    pathname.startsWith("/settings")
  ) {
    return "expense";
  }
  return null;
}

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const preflight = handleApiPreflight(req);
  if (preflight) return preflight;

  const pathname = req.nextUrl.pathname;

  // === Locale routing for marketing pages ===
  //
  // Strategy: locale lives in the URL (`/en/...`, `/he/...`) so search
  // engines can index each language independently. Bare paths like
  // `/contact` are 308-redirected to the user's locale. Auth/app/api/dev
  // routes are explicitly excluded because their language is driven by
  // the saved cookie, not the URL.
  const existingPrefix = readLocalePrefix(pathname);
  if (existingPrefix) {
    // URL has a locale prefix — surface it to server components via a
    // request header so `getLocale()` honours it ahead of the cookie.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-locale", existingPrefix);
    const res = NextResponse.next({ request: { headers: requestHeaders } });

    // Persist the URL-driven locale into the cookie so subsequent
    // navigations to non-localized routes (e.g. /login) stay in language
    // and so the language switcher reads a sensible "current" value.
    //
    // EXCEPTION: if the user has explicitly picked a language on this device
    // (`NEXT_LOCALE_SET=1`), do NOT overwrite their pick just because they
    // landed on a `/he/*` (or `/en/*`) URL — that URL might come from a
    // stale 308 redirect cached by the browser, an external link, or a geo
    // redirect on a different device. The `x-locale` header above is enough
    // to render this one request in the prefix's language; the persisted
    // preference must keep reflecting the user's manual choice and override
    // any other signal (geo, accept-language, cached redirects).
    const hasExplicitChoice =
      req.cookies.get(LOCALE_EXPLICIT_COOKIE)?.value === "1";
    if (
      !hasExplicitChoice &&
      req.cookies.get(LOCALE_COOKIE)?.value !== existingPrefix
    ) {
      res.cookies.set(LOCALE_COOKIE, existingPrefix, {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        secure: SECURE_COOKIES,
      });
    }

    if (isPublicApi(pathname)) applyApiCors(res);
    if (req.auth?.user) {
      const mode = modeForPathname(pathname);
      if (mode !== null) {
        res.cookies.set(MODE_COOKIE_NAME, mode, {
          httpOnly: false,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
          secure: SECURE_COOKIES,
        });
      }
    }
    return res;
  }

  if (isLocalizedPublicPath(pathname)) {
    // Signed-in users hitting `/` stay in the app (InvoLoops home). Guests
    // still go to the locale marketing page.
    if (pathname === "/" && req.auth?.user) {
      const res = NextResponse.next();
      res.cookies.set(MODE_COOKIE_NAME, "expense", {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        secure: SECURE_COOKIES,
      });
      return res;
    }
    // Bare marketing path — redirect to the locale variant. MUST be 307
    // (Temporary), not 308 (Permanent): the destination depends on a per-user
    // signal (cookie / geo / Accept-Language). 308 is cached indefinitely by
    // browsers without an explicit `Cache-Control`, which means a visitor who
    // first lands as `/ → /he` will keep being sent to `/he` from the browser
    // cache even after they explicitly switch the language to English. The
    // request never reaches the server, so the cookie update is ignored.
    // We also force `Cache-Control: no-store` defensively in case any
    // intermediate (Cloudflare, Vercel) tries to cache the redirect.
    const locale = detectLocale(req);
    const url = req.nextUrl.clone();
    url.pathname = pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
    const redirect = NextResponse.redirect(url, 307);
    redirect.headers.set("Cache-Control", "no-store");
    redirect.headers.set("Vary", "Cookie");
    return redirect;
  }

  // === Existing behaviour (auth / mode / CORS) ===
  const res = NextResponse.next();

  if (isPublicApi(pathname)) {
    applyApiCors(res);
  }

  if (!req.auth?.user) {
    return res;
  }

  const mode = modeForPathname(pathname);
  if (mode !== null) {
    res.cookies.set(MODE_COOKIE_NAME, mode, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      secure: SECURE_COOKIES,
    });
  }

  return res;
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
