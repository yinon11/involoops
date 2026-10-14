/**
 * Single source of truth for "what tier is this user on, right now?"
 *
 * Used by both the quota enforcer (`checkUsageLimit`) and the settings UI
 * (`getCurrentPlan`) so the two can never drift. BYOK (user-provided
 * Claude key) is the key part of the policy:
 *
 *   - A user with a verified stored key is treated as Enterprise
 *     (500 invoices / month, no Stripe charge) — but the check is always
 *     server-side, against the DB, on every request. Removing the key
 *     reverts the user to their real subscription tier instantly.
 *   - A user without a key falls back to their paid Stripe subscription
 *     (if active and within its billing window) or the Free tier.
 *
 * This design is what prevents the "set key → get enterprise → remove key
 * → keep enterprise" exploit: the tier is re-derived from scratch every
 * time it's needed. There's no persisted "byok granted" flag anywhere.
 */

import { db } from "@/db";
import { pricingTiers } from "@/db/schema/pricing-tiers";
import { userSubscriptions } from "@/db/schema/user-subscriptions";
import { eq } from "drizzle-orm";
import { isUserByok } from "@/lib/user-api-key";

/** Hard cap for BYOK users. They pay Anthropic for LLM calls, but we still
 *  cap invoice count to keep storage / DB / bandwidth predictable. */
export const BYOK_MONTHLY_INVOICE_CAP = 500;

export interface EffectiveTier {
  tierName: string;
  tierCode: string;
  maxInvoices: number;
  priceMonthly: string;
  /** "free" | "active" | "byok" | actual subscription status */
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  /** True when the user is on BYOK (has a valid stored Anthropic key). */
  byok: boolean;
}

function isPaidSubscriptionEntitled(
  status: string,
  currentPeriodStart: Date | null,
  currentPeriodEnd: Date | null
): boolean {
  if (status !== "active") return false;
  const now = new Date();
  if (!currentPeriodStart || currentPeriodStart > now) return false;
  if (!currentPeriodEnd || currentPeriodEnd <= now) return false;
  return true;
}

async function getFreeTier(): Promise<EffectiveTier> {
  const free = await db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.code, "free"),
  });
  return {
    tierName: free?.name ?? "Free",
    tierCode: "free",
    maxInvoices: free?.maxInvoicesPerMonth ?? 10,
    priceMonthly: free?.priceMonthly ?? "0",
    status: "free",
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    byok: false,
  };
}

async function getByokTier(): Promise<EffectiveTier> {
  // Reuse the Enterprise tier's display details if it exists, so the UI
  // feels identical to a paid Enterprise user. If the seed hasn't run yet,
  // synthesize a reasonable default so the BYOK path still works.
  const enterprise = await db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.code, "enterprise"),
  });
  return {
    tierName: enterprise?.name ?? "Enterprise",
    tierCode: "enterprise",
    maxInvoices: Math.min(
      enterprise?.maxInvoicesPerMonth ?? BYOK_MONTHLY_INVOICE_CAP,
      BYOK_MONTHLY_INVOICE_CAP
    ),
    // BYOK users are not billed by us — show $0/mo in the plan card.
    priceMonthly: "0",
    status: "byok",
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    byok: true,
  };
}

/**
 * Resolve the user's effective tier right now.
 *
 * Order of precedence:
 *   1. BYOK (verified user key in DB) → Enterprise-equivalent, 500/mo.
 *   2. Paid Stripe subscription inside a valid billing window → that tier.
 *   3. Otherwise → Free.
 */
export async function resolveEffectiveTier(
  userId: string
): Promise<EffectiveTier> {
  // (1) Always check the DB on every call — never trust a cached flag.
  if (await isUserByok(userId)) {
    return getByokTier();
  }

  // (2) Inspect the Stripe subscription row, if any.
  const [sub] = await db
    .select({
      tierName: pricingTiers.name,
      tierCode: pricingTiers.code,
      maxInvoices: pricingTiers.maxInvoicesPerMonth,
      priceMonthly: pricingTiers.priceMonthly,
      status: userSubscriptions.status,
      stripeSubscriptionId: userSubscriptions.stripeSubscriptionId,
      stripeCustomerId: userSubscriptions.stripeCustomerId,
      currentPeriodStart: userSubscriptions.currentPeriodStart,
      currentPeriodEnd: userSubscriptions.currentPeriodEnd,
    })
    .from(userSubscriptions)
    .innerJoin(pricingTiers, eq(userSubscriptions.pricingTierId, pricingTiers.id))
    .where(eq(userSubscriptions.userId, userId))
    .limit(1);

  if (!sub) {
    return getFreeTier();
  }

  if (sub.tierCode === "free") {
    return {
      tierName: sub.tierName,
      tierCode: sub.tierCode,
      maxInvoices: sub.maxInvoices,
      priceMonthly: sub.priceMonthly,
      status: sub.status,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      stripeCustomerId: sub.stripeCustomerId,
      byok: false,
    };
  }

  if (
    isPaidSubscriptionEntitled(
      sub.status,
      sub.currentPeriodStart,
      sub.currentPeriodEnd
    )
  ) {
    return {
      tierName: sub.tierName,
      tierCode: sub.tierCode,
      maxInvoices: sub.maxInvoices,
      priceMonthly: sub.priceMonthly,
      status: sub.status,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      stripeCustomerId: sub.stripeCustomerId,
      byok: false,
    };
  }

  // Paid row but the billing window lapsed / is pending — fall back to free.
  return getFreeTier();
}
