import type { NextConfig } from "next";

/**
 * Base security headers applied to every response.
 *
 * Notes:
 * - `frame-ancestors 'self'` keeps the invoice preview iframe working while
 *   blocking clickjacking from other origins. `X-Frame-Options: SAMEORIGIN`
 *   pairs with it for old browsers.
 * - Next.js 16 streams React markup with inline `<script>` bootstraps, so
 *   `'unsafe-inline'` is required on `script-src` until we migrate to a
 *   strict-dynamic nonce. `'unsafe-eval'` is retained for Turbopack dev.
 * - GTM dynamically loads whatever tags you configure (Google Analytics,
 *   Microsoft Clarity, Facebook Pixel, etc.), so pinning `script-src-elem`
 *   to a specific domain list breaks new tags every time the marketing team
 *   adds one. We allow `https:` for external scripts — combined with the
 *   existing `'unsafe-inline'` this doesn't materially weaken the policy
 *   (the real hardening would be a per-request nonce + strict-dynamic), and
 *   `upgrade-insecure-requests` still blocks plain HTTP.
 * - `connect-src` is similarly `https:`/`wss:` to let vendor beacons
 *   (analytics, session replay) fire without maintenance.
 * - `form-action` keeps the server in control: only same-origin POSTs,
 *   Google sign-in, Claude's connector callback, and Claude Code's loopback
 *   callback are allowed. Browsers also check this directive against
 *   redirects that follow a form POST, so Allow cannot return to those
 *   hosts without them. The loopback sources use any port.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self' https://accounts.google.com https://claude.ai http://127.0.0.1:* http://localhost:* http://127.0.0.1 http://localhost",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "script-src-elem 'self' 'unsafe-inline' https:",
  "connect-src 'self' https: wss: blob:",
  "frame-src 'self' blob: https:",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(self)",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/** Must match `NEW_DESIGN_COOKIE_NAME` in `src/lib/new-design.ts`. */
const NEW_DESIGN_COOKIE = "involoops_new_design";
const whenNewDesignEnabled = [
  { type: "cookie" as const, key: NEW_DESIGN_COOKIE, value: "1" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["puppeteer", "undici", "oidc-provider"],
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  async redirects() {
    return [
      // Unified-shell URL rewrites apply only when the user opted into the new
      // design (admin cookie). Default / old design keeps legacy paths working.
      {
        source: "/dashboard",
        has: whenNewDesignEnabled,
        destination: "/money-out",
        permanent: false,
      },
      {
        source: "/income",
        has: whenNewDesignEnabled,
        destination: "/money-in",
        permanent: false,
      },
      {
        source: "/profit",
        has: whenNewDesignEnabled,
        destination: "/money-in",
        permanent: false,
      },
      {
        source: "/customers",
        has: whenNewDesignEnabled,
        destination: "/clients",
        permanent: false,
      },
      {
        source: "/outbound/collections",
        has: whenNewDesignEnabled,
        destination: "/money-in",
        permanent: false,
      },
      {
        source: "/creator",
        has: whenNewDesignEnabled,
        destination: "/",
        permanent: false,
      },
      {
        source: "/creator/business-details",
        has: whenNewDesignEnabled,
        destination: "/settings?tab=business",
        permanent: false,
      },
      {
        source: "/settings/ita-integration",
        has: whenNewDesignEnabled,
        destination: "/settings?tab=integrations",
        permanent: false,
      },
      {
        source: "/creator/template",
        has: whenNewDesignEnabled,
        destination: "/settings?tab=templates",
        permanent: false,
      },
      {
        source: "/settings/api-keys",
        has: whenNewDesignEnabled,
        destination: "/settings?tab=api",
        permanent: false,
      },
      // Legacy bookmark; safe for all users (canonical route lives under outbound).
      { source: "/tax-estimates", destination: "/outbound/tax-estimates", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
