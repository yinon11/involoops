/**
 * Policy registry mapping error keys to a delivery strategy.
 *
 * - `immediate`: write a row and email the owner now (rate-limited per
 *   fingerprint via `IMMEDIATE_RATE_LIMIT_MINUTES` so a deploy that floods one
 *   key doesn't pager-storm the inbox).
 * - `digest`:    write a row with `sent_at = null`. The daily cron at
 *   `/api/cron/error-digest` collapses pending rows by fingerprint and sends
 *   one summary email.
 * - `ignore`:    no row, no email. Kept in the map (rather than omitted) so
 *   callers' `ErrorKey` union still type-checks for known-noisy keys we want
 *   the option to flip on later.
 *
 * Adding a key is a code change on purpose: errors are part of the contract
 * with the codebase, and a static map is greppable and reviewable. If
 * non-engineers need to edit policies, move this to a DB table later.
 */
export type ErrorPolicy = "immediate" | "digest" | "ignore";

export const ERROR_POLICIES = {
  // User-blocking, owner needs to know now.
  upload_storage_error: "immediate",
  auth_unexpected: "immediate",
  db_constraint_violation: "immediate",
  stripe_webhook_failure: "immediate",
  shaam_submission_failure: "immediate",

  // Noisy but worth reviewing daily.
  extraction_failed: "digest",
  vision_api_error: "digest",
  duplicate_detection_warning: "digest",
  email_send_failure: "digest",
  background_job_failure: "digest",

  // Known noisy and not actionable today; flip to "digest" if needed.
  client_log_warning: "ignore",
} as const satisfies Record<string, ErrorPolicy>;

export type ErrorKey = keyof typeof ERROR_POLICIES;

/** Skip a second `immediate` email for the same fingerprint within this window. */
export const IMMEDIATE_RATE_LIMIT_MINUTES = 15;
