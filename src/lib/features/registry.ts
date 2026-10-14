/**
 * Single source of truth for feature flags used to gate user-facing
 * capabilities (NOT release flags — those should be `process.env`, and
 * NOT RBAC permissions — those live in `src/lib/rbac/permissions.ts`).
 *
 * Rules of the road:
 *
 *   1. Feature names are stable identifiers. Once shipped, do not rename
 *      a value — that would silently revoke every existing grant. Add a
 *      new key and migrate.
 *   2. Names describe a capability ("invoice_generator"), never a gate
 *      ("disable_invoice_generator"). Negations rot fast.
 *   3. The catalogue lives here; the *grants* live in
 *      `user_feature_grants`. Adding a feature is a typed code change,
 *      never a database migration.
 *   4. Plan-level defaults — which tier grants which feature out of the
 *      box — live in `./plan-defaults.ts`.
 *   5. The only consumer of these strings is `./has-feature.ts`. Server
 *      actions and server components MUST go through `requireFeature` /
 *      `hasFeature` rather than hand-rolling DB reads.
 */
export const FEATURES = {
  /**
   * Outbound invoicing (Studio: `/creator`, `/outbound/*`, `/customers/*`,
   * business-entity settings, ITA integration). Granted on every pricing
   * tier — every signed-in user can open Studio. Issuing documents still
   * requires a registered business entity plus the usual RBAC caps.
   */
  INVOICE_GENERATOR: "invoice_generator",
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

/** All known feature codes, useful for admin UIs and validation. */
export const ALL_FEATURES: ReadonlyArray<Feature> = Object.values(FEATURES);

/** Type guard for runtime input (CLI args, admin form posts, etc.). */
export function isFeature(value: unknown): value is Feature {
  return typeof value === "string" && (ALL_FEATURES as string[]).includes(value);
}
