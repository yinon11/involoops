"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { pricingTiers } from "@/db/schema/pricing-tiers";
import { users } from "@/db/schema/users";
import { userSubscriptions } from "@/db/schema/user-subscriptions";
import { eq, asc } from "drizzle-orm";
import { getCurrentMonthUsage } from "@/lib/usage";
import { resolveEffectiveTier } from "@/lib/effective-tier";
import {
  createCheckoutSession,
  createBillingPortalSession,
} from "@/lib/stripe";
import {
  REGISTRATION_KIND_TEUDAT_ZEHUT,
  subscriberCheckoutBillingSchema,
  type SubscriberCheckoutBilling,
} from "@/lib/billing/subscriber-checkout-billing";
import { getDictionary } from "@/lib/i18n/server";

export interface PlanInfo {
  tierName: string;
  tierCode: string;
  maxInvoices: number;
  priceMonthly: string;
  status: string;
  currentUsage: number;
  yearMonth: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  /** True when the user is uploading on their own Anthropic key. */
  byok: boolean;
}

export async function getCurrentPlan(): Promise<PlanInfo | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  // Re-derive from scratch — never trust a cached "tier" for BYOK users.
  const tier = await resolveEffectiveTier(userId);
  const usage = await getCurrentMonthUsage(userId);

  return {
    tierName: tier.tierName,
    tierCode: tier.tierCode,
    maxInvoices: tier.maxInvoices,
    priceMonthly: tier.priceMonthly,
    status: tier.status,
    currentUsage: usage.count,
    yearMonth: usage.yearMonth,
    stripeSubscriptionId: tier.stripeSubscriptionId,
    stripeCustomerId: tier.stripeCustomerId,
    byok: tier.byok,
  };
}

export interface AvailableTier {
  id: string;
  name: string;
  code: string;
  maxInvoicesPerMonth: number;
  priceMonthly: string;
  features: string[];
  stripePriceIdMonthly: string | null;
}

export async function getAvailablePlans(): Promise<AvailableTier[]> {
  const tiers = await db
    .select()
    .from(pricingTiers)
    .where(eq(pricingTiers.isActive, true))
    .orderBy(asc(pricingTiers.sortOrder));

  return tiers.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    maxInvoicesPerMonth: t.maxInvoicesPerMonth,
    priceMonthly: t.priceMonthly,
    features: (t.features as string[]) ?? [],
    stripePriceIdMonthly: t.stripePriceIdMonthly,
  }));
}

export async function createUpgradeSession(
  tierId: string,
  billing: SubscriberCheckoutBilling,
): Promise<{ url: string | null; error?: string }> {
  const dict = await getDictionary();
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { url: null, error: dict.errors.notAuthorized };
  }

  const parsed = subscriberCheckoutBillingSchema.safeParse(billing);
  if (!parsed.success) {
    return { url: null, error: "invalid_billing_details" };
  }

  const tier = await db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.id, tierId),
  });

  if (!tier || !tier.stripePriceIdMonthly) {
    return { url: null, error: dict.errors.invalidPlanOrStripe };
  }

  const origin =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000";

  try {
    await db
      .update(users)
      .set({
        name: parsed.data.subscriberName,
        companyName: parsed.data.businessLegalName,
      })
      .where(eq(users.id, session.user.id));

    const registrationKind =
      parsed.data.registrationScheme === "tz"
        ? REGISTRATION_KIND_TEUDAT_ZEHUT
        : parsed.data.entityType!;

    const url = await createCheckoutSession({
      userId: session.user.id,
      email: session.user.email,
      name: parsed.data.subscriberName,
      stripePriceId: tier.stripePriceIdMonthly,
      successUrl: `${origin}/settings?upgraded=true`,
      cancelUrl: `${origin}/settings`,
      subscriberDetails: {
        subscriberName: parsed.data.subscriberName,
        businessLegalName: parsed.data.businessLegalName,
        registrationKind,
        registrationNumberDigits: parsed.data.registrationNumber,
      },
    });

    if (!url) {
      return { url: null, error: dict.errors.stripeNotConfigured };
    }

    return { url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Upgrade] Checkout session failed:", message);
    return { url: null, error: message };
  }
}

export async function createCancelSession(): Promise<{
  url: string | null;
  error?: string;
}> {
  const dict = await getDictionary();
  const session = await auth();
  if (!session?.user?.id) return { url: null, error: dict.errors.notAuthorized };

  const sub = await db.query.userSubscriptions.findFirst({
    where: eq(userSubscriptions.userId, session.user.id),
  });

  if (!sub?.stripeCustomerId) {
    return { url: null, error: dict.errors.noActiveSubscription };
  }

  const origin =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000";

  const url = await createBillingPortalSession(
    sub.stripeCustomerId,
    `${origin}/settings`,
  );

  return { url };
}
