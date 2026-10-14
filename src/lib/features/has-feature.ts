import { cache } from "react";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { userFeatureGrants } from "@/db/schema";
import { isUserAdmin } from "@/lib/is-user-admin";
import { resolveEffectiveTier } from "@/lib/effective-tier";
import { FEATURES_BY_TIER } from "./plan-defaults";
import { ALL_FEATURES, type Feature } from "./registry";

/**
 * Resolve the full set of features a user is currently entitled to.
 *
 * Precedence (mirrors `resolveEffectiveTier` in spirit — never trust a
 * cached flag, re-derive from the DB on every fresh request):
 *
 *   1. Platform admin short-circuit: `isUserAdmin(userId)` ⇒ all features.
 *      This keeps existing admin behaviour intact while we migrate gates
 *      off raw `isAdmin` checks. Eventually the only `isAdmin` reference
 *      in the gating path is *here*.
 *   2. Plan defaults: features attached to the user's effective pricing
 *      tier (BYOK users resolve as enterprise — they inherit whatever
 *      enterprise grants).
 *   3. Active per-user grants in `user_feature_grants`: not revoked AND
 *      either no expiry or expiry in the future.
 *
 * `cache()` memoises per request so the layout, page body, and any
 * server actions in the same render share a single DB hit.
 *
 * Read-side ONLY. Granting / revoking happens through the admin
 * settings UI (or `scripts/grant-feature.ts`); never mutate from here.
 */
export const getUserFeatures = cache(
  async (userId: string): Promise<Set<Feature>> => {
    if (await isUserAdmin(userId)) {
      return new Set<Feature>(ALL_FEATURES);
    }

    const tier = await resolveEffectiveTier(userId);
    const fromPlan = FEATURES_BY_TIER[tier.tierCode] ?? [];

    const now = new Date();
    const grants = await db
      .select({ feature: userFeatureGrants.feature })
      .from(userFeatureGrants)
      .where(
        and(
          eq(userFeatureGrants.userId, userId),
          isNull(userFeatureGrants.revokedAt),
          or(
            isNull(userFeatureGrants.expiresAt),
            gt(userFeatureGrants.expiresAt, now),
          ),
        ),
      );

    const features = new Set<Feature>(fromPlan);
    for (const g of grants) {
      // Defensive: silently drop stale rows whose `feature` string is no
      // longer in the registry (we deleted or renamed it). Authorization
      // shouldn't crash because the catalogue moved.
      if ((ALL_FEATURES as ReadonlyArray<string>).includes(g.feature)) {
        features.add(g.feature as Feature);
      }
    }
    return features;
  },
);

export async function hasFeature(
  userId: string,
  feature: Feature,
): Promise<boolean> {
  const features = await getUserFeatures(userId);
  return features.has(feature);
}

/**
 * Throw a generic error when the user lacks the feature. The message is
 * intentionally indistinguishable from "not found" so a probing client
 * cannot tell "feature exists but you can't use it" from "no such thing"
 * — same reasoning as `AuthorizationError` in the RBAC layer.
 */
export async function requireFeature(
  userId: string,
  feature: Feature,
): Promise<void> {
  if (!(await hasFeature(userId, feature))) {
    throw new FeatureNotEntitledError(feature);
  }
}

export class FeatureNotEntitledError extends Error {
  readonly feature: Feature;
  constructor(feature: Feature) {
    super("Not found");
    this.name = "FeatureNotEntitledError";
    this.feature = feature;
  }
}
