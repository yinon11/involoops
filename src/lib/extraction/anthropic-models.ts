/**
 * Anthropic model selection + typed errors for invoice extraction.
 *
 * Model names are env-overridable so we can ship new models (or roll back
 * to a cheaper one) without redeploying code:
 *
 *   ANTHROPIC_EXTRACTION_MODEL    — text + vision invoice field extraction
 *   ANTHROPIC_SEGMENTATION_MODEL  — multi-invoice PDF segmentation (Haiku)
 *
 * Defaults match what the codebase shipped with before this file existed.
 */

// Sonnet 4 (claude-sonnet-4-20250514) was retired by Anthropic on 2026-06-15.
// claude-sonnet-4-6 is Anthropic's recommended replacement. Override with
// ANTHROPIC_EXTRACTION_MODEL if needed.
const DEFAULT_EXTRACTION_MODEL = "claude-sonnet-4-6";
const DEFAULT_SEGMENTATION_MODEL = "claude-haiku-4-5-20251001";

export function getExtractionModel(): string {
  return process.env.ANTHROPIC_EXTRACTION_MODEL?.trim() || DEFAULT_EXTRACTION_MODEL;
}

export function getSegmentationModel(): string {
  return (
    process.env.ANTHROPIC_SEGMENTATION_MODEL?.trim() ||
    DEFAULT_SEGMENTATION_MODEL
  );
}

/**
 * Thrown when Anthropic returns a `not_found_error` (HTTP 404) for the
 * extraction model. In practice this means the *user's* BYOK key does not
 * have access to the model we need (Sonnet 4 is gated by tier on Anthropic's
 * side). Distinguish from generic extraction errors so the upload route
 * can surface a clear, actionable message instead of silently writing an
 * empty pending invoice.
 */
export class AnthropicModelAccessError extends Error {
  constructor(
    public readonly model: string,
    public readonly source: "user" | "platform" | "unknown" = "unknown",
    cause?: unknown
  ) {
    const who =
      source === "user"
        ? "Your Anthropic API key does not have access to the required model"
        : "The configured Anthropic model is not available";
    super(
      `${who} (${model}). ` +
        (source === "user"
          ? "Either remove your custom Anthropic key in Settings → API Keys to use the platform key, or upgrade your Anthropic account to a tier that includes Claude Sonnet 4."
          : "Set ANTHROPIC_EXTRACTION_MODEL to a model your account can access.")
    );
    this.name = "AnthropicModelAccessError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Detect Anthropic `not_found_error` (404, model gated for this key).
 * The SDK shapes errors as either `{ status: 404, error: { type: 'not_found_error' } }`
 * or `{ status: 404, message: '... not_found_error: model: ...' }`. Be lenient.
 */
export function isAnthropicModelNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    error?: { type?: unknown } | unknown;
    message?: unknown;
  };
  const status =
    typeof e.status === "number"
      ? e.status
      : typeof e.statusCode === "number"
        ? e.statusCode
        : null;
  if (status !== 404) return false;
  const inner =
    e.error && typeof e.error === "object"
      ? (e.error as { type?: unknown }).type
      : null;
  if (typeof inner === "string" && inner === "not_found_error") return true;
  if (typeof e.message === "string" && /not_found_error/.test(e.message)) {
    return true;
  }
  // Some 404s come from non-existent endpoints rather than gated models;
  // treat those as model-not-found too — the symptom (extraction can't
  // run) is the same and the message we surface is still accurate.
  return true;
}
