/**
 * Next.js instrumentation hook. Runs once per server process boot.
 *
 * We use it as a lazy-renewal trigger for the Gmail watch()
 * subscription. Combined with the same check in the webhook (on every
 * push), this replaces a time-based cron — no external scheduler
 * needed. See `src/lib/gmail/renew.ts` for the policy.
 *
 * Intentionally a no-op when:
 *   - Running on the Edge runtime (this uses Node.js-only modules)
 *   - GMAIL_* env vars are missing (local dev without intake)
 *   - No watch state row yet (operator must run the register script)
 *
 * Never throws; failures are logged. Crashing startup over a failed
 * third-party API call would be a very bad trade.
 */

export async function register(): Promise<void> {
  // Guard: only run in Node.js server runtime. The Edge runtime (used
  // for middleware and some route handlers) can't talk to our DB or
  // Gmail SDK.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Patch console.* into a ring buffer so the "I have a problem with this
  // invoice" report can attach the recent server log tail. Doing this from
  // the boot hook (rather than at first server-action call) ensures we
  // capture logs from the rest of startup and every request that follows.
  await import("@/lib/server-logs");

  // Sandbox must not boot with a production signing key. This exits the
  // process. It runs before anything else that could sign a document.
  const { assertSigningKeyBoot } = await import("@/lib/signing/sandbox-guard");
  await assertSigningKeyBoot();

  // OAuth must not boot on oidc-provider's published development key.
  const { assertOauthJwksBoot } = await import("@/lib/oauth/jwks");
  assertOauthJwksBoot();

  // Dynamic import so the Edge bundle doesn't pull in googleapis etc.
  // (Even though we return early above, Next's bundler still tries to
  // trace the imports if they're static.)
  const { renewWatchIfExpiring } = await import("@/lib/gmail/renew");

  try {
    const result = await renewWatchIfExpiring();
    switch (result.action) {
      case "renewed":
        console.log(
          `[gmail.startup] watch renewed for ${result.mailbox}, expires in ${Math.round(
            (result.msUntilExpiry ?? 0) / 86_400_000,
          )}d`,
        );
        break;
      case "skip":
        console.log(
          `[gmail.startup] watch OK for ${result.mailbox}, expires in ${Math.round(
            (result.msUntilExpiry ?? 0) / 86_400_000,
          )}d`,
        );
        break;
      case "no-topic":
        // GMAIL_PUBSUB_TOPIC unset — feature disabled for this env.
        // Silent: local dev shouldn't see scary logs about missing prod config.
        break;
      case "no-state":
        console.warn(
          `[gmail.startup] no watch state for ${result.mailbox} — run scripts/gmail-watch-register.mjs`,
        );
        break;
      case "error":
        console.error(
          `[gmail.startup] watch renew failed for ${result.mailbox}: ${result.error}`,
        );
        break;
    }
  } catch (err) {
    // Defensive: renewWatchIfExpiring already catches internally, but
    // a top-level guard ensures no import-time failure escapes to
    // crash server boot.
    console.error("[gmail.startup] unexpected error:", err);
  }
}
