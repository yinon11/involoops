/**
 * Print resolved SHAAM OAuth + clearance URLs from process.env.
 * No network, no DB — safe to run in production for diagnostics.
 *
 *   npx tsx scripts/print-shaam-config.ts
 *
 * In Docker (compose service `app`, container_name `invoices-app`):
 *   docker exec invoices-app npx tsx scripts/print-shaam-config.ts
 */

import {
  getShaamClearanceBaseUrl,
  getShaamConfig,
  getShaamInvoicePath,
} from "@/lib/shaam/client";
import {
  getShaamProxyHostPort,
  isShaamProxyEnabled,
} from "@/lib/shaam/proxy";

function main() {
  const cfg = getShaamConfig();
  const clearanceBase = getShaamClearanceBaseUrl();
  const invoicePath = getShaamInvoicePath();

  const oauthAuthorize = new URL(cfg.authorizePath, cfg.baseUrl).toString();
  const oauthToken = new URL(cfg.tokenPath, cfg.baseUrl).toString();
  const oauthRevoke = new URL(cfg.revokePath, cfg.baseUrl).toString();
  const clearancePost = new URL(invoicePath, clearanceBase).toString();

  const out = {
    SHAAM_ENV: cfg.environment,
    oauth: {
      base_url: cfg.baseUrl,
      authorize_path: cfg.authorizePath,
      token_path: cfg.tokenPath,
      revoke_path: cfg.revokePath,
      resolved_authorize_url: oauthAuthorize,
      resolved_token_url: oauthToken,
      resolved_revoke_url: oauthRevoke,
    },
    clearance: {
      base_url: clearanceBase,
      invoice_path: invoicePath,
      resolved_post_url: clearancePost,
    },
    oauth_scope: cfg.scope,
    redirect_uri: cfg.redirectUri,
    client_id_prefix:
      cfg.clientId.length > 0 ? `${cfg.clientId.slice(0, 6)}…` : "(empty)",
    client_secret_set: Boolean(cfg.clientSecret),
    proxy_url_set: Boolean(process.env.SHAAM_PROXY_URL?.trim()),
    proxy_enabled: isShaamProxyEnabled(),
    // What shaamFetch will actually do: null = direct egress.
    proxy_in_effect: getShaamProxyHostPort(),
    tenant_submit_serialize:
      process.env.SHAAM_TENANT_SUBMIT_SERIALIZE === "1" ? "1" : "0",
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
