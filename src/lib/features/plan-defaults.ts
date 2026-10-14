import { FEATURES, type Feature } from "./registry";

/**
 * Which features each pricing tier grants out of the box.
 *
 * Keys are `pricing_tiers.code` values. Tiers not listed here grant zero
 * features by default — extra capability must come from a per-user grant
 * in `user_feature_grants`.
 *
 * Kept in code (not in `pricing_tiers.features`) on purpose:
 *   - `pricing_tiers.features` is a *display* list (user-facing English /
 *     Hebrew bullet points on the marketing card) and evolves at marketing
 *     cadence.
 *   - This map is *authorization* and evolves at engineering cadence; it
 *     wants type safety and code review, not an admin form.
 *
 * The two will sometimes drift on purpose (e.g. you ship a feature to
 * Enterprise before adding the bullet to the marketing card).
 */
export const FEATURES_BY_TIER: Readonly<Record<string, ReadonlyArray<Feature>>> = {
  free: [FEATURES.INVOICE_GENERATOR],
  professional: [FEATURES.INVOICE_GENERATOR],
  enterprise: [FEATURES.INVOICE_GENERATOR],
};
