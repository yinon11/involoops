import Stripe from "stripe";
import { db } from "@/db";
import { userSubscriptions } from "@/db/schema/user-subscriptions";
import { eq } from "drizzle-orm";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = new Stripe(key, { apiVersion: "2025-04-30.basil" });
  return _stripe;
}

/**
 * Get or create a Stripe customer for a user.
 */
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
  name?: string | null,
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  // Check if user already has a Stripe customer ID
  const sub = await db.query.userSubscriptions.findFirst({
    where: eq(userSubscriptions.userId, userId),
  });

  if (sub?.stripeCustomerId) return sub.stripeCustomerId;

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    name: name ?? undefined,
    metadata: { userId },
  });

  // Update subscription record with customer ID
  if (sub) {
    await db
      .update(userSubscriptions)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(userSubscriptions.id, sub.id));
  }

  return customer.id;
}

function digitsOnly(raw: string, maxLen: number): string {
  const d = raw.replace(/\D/g, "");
  return d.length > maxLen ? d.slice(0, maxLen) : d;
}

/**
 * Create a Stripe Checkout Session for upgrading to a paid plan.
 *
 * Optional `subscriberDetails` is copied into Checkout + subscription metadata
 * and merged onto the Stripe customer for billing/bookkeeping visibility.
 */
export async function createCheckoutSession(params: {
  userId: string;
  email: string;
  name?: string | null;
  stripePriceId: string;
  successUrl: string;
  cancelUrl: string;
  subscriberDetails?: {
    subscriberName: string;
    businessLegalName: string;
    /** Drizzle `entity_type` value or TEUDAT_ZEHUT when using ת.ז. */
    registrationKind: string;
    registrationNumberDigits: string;
  };
}): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const displayName = params.subscriberDetails?.subscriberName ?? params.name;

  const customerId = await getOrCreateStripeCustomer(
    params.userId,
    params.email,
    displayName,
  );

  const price = await stripe.prices.retrieve(params.stripePriceId);
  if (!price.recurring) {
    throw new Error(
      "Stripe price is not recurring. In Dashboard → Products, add a price with " +
        "Billing period (e.g. monthly), then set pricing_tiers.stripe_price_id_monthly to that price id.",
    );
  }

  let billingMeta: Record<string, string> = {};
  if (params.subscriberDetails) {
    const d = params.subscriberDetails;
    const subName = d.subscriberName.slice(0, 400);
    const legal = d.businessLegalName.slice(0, 400);
    const regKind = d.registrationKind.slice(0, 64);
    const regNum = digitsOnly(d.registrationNumberDigits, 32);
    billingMeta = {
      subscriber_name: subName,
      business_legal_name: legal,
      registration_kind: regKind,
      registration_number: regNum,
    };

    if (customerId) {
      const existing = await stripe.customers.retrieve(customerId);
      if (!existing.deleted) {
        const prev = existing.metadata ?? {};
        await stripe.customers.update(customerId, {
          name: subName,
          metadata: {
            ...prev,
            userId: params.userId,
            ...billingMeta,
          },
        });
      }
    }
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId ?? undefined,
    customer_email: customerId ? undefined : params.email,
    mode: "subscription",
    line_items: [{ price: params.stripePriceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
    metadata: { userId: params.userId, ...billingMeta },
    subscription_data: {
      metadata: { userId: params.userId, ...billingMeta },
    },
  });

  return session.url;
}

/**
 * Create a Stripe Billing Portal session for cancellation.
 */
export async function createBillingPortalSession(
  stripeCustomerId: string,
  returnUrl: string,
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}
