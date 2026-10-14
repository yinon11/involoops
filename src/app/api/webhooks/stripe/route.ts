import { NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/db";
import { userSubscriptions } from "@/db/schema/user-subscriptions";
import { pricingTiers } from "@/db/schema/pricing-tiers";
import { users } from "@/db/schema/users";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";
import { onFunnelEvent } from "@/lib/email/funnel-event-service";
import { FunnelEvents } from "@/lib/email/funnel-constants";
import { sendNewSubscriptionNotification } from "@/lib/email/transactional";
import { getPublicAppOrigin } from "@/lib/public-app-origin";
import {
  createStudioReceiptForStripeInvoice,
  getStudioReceiptMode,
} from "@/lib/billing/studio-receipt";

/**
 * Redact an unknown error down to a single-line string suitable for logs.
 * Full error objects can include request bodies, SQL parameters, and PII that
 * we don't want shipped to third-party log sinks.
 */
function safeLogError(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) {
    return `StripeError ${err.type ?? "unknown"}: ${err.message}`;
  }
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return "Unknown error";
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Look up our userId from a Stripe subscription or customer object.
 * Checks: subscription metadata → customer metadata → DB lookup.
 */
async function resolveUserId(
  stripe: Stripe,
  sub?: Stripe.Subscription | null,
  customerId?: string | null,
): Promise<string | null> {
  if (sub?.metadata?.userId) return sub.metadata.userId;

  if (customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted && customer.metadata?.userId) {
      return customer.metadata.userId;
    }

    const dbSub = await db.query.userSubscriptions.findFirst({
      where: eq(userSubscriptions.stripeCustomerId, customerId),
    });
    if (dbSub) return dbSub.userId;
  }

  return null;
}

function getCustomerId(sub: Stripe.Subscription): string | null {
  return typeof sub.customer === "string"
    ? sub.customer
    : sub.customer?.id ?? null;
}

function getSubPeriod(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  return {
    priceId: item?.price?.id ?? null,
    periodStart: item?.current_period_start
      ? new Date(item.current_period_start * 1000)
      : null,
    periodEnd: item?.current_period_end
      ? new Date(item.current_period_end * 1000)
      : null,
  };
}

/** Map Stripe subscription status to our internal status */
const STATUS_MAP: Record<string, string> = {
  active: "active",
  trialing: "active",
  past_due: "past_due",
  unpaid: "past_due",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  canceled: "canceled",
  paused: "past_due",
};

async function findTierByPrice(priceId: string | null) {
  if (!priceId) return null;
  return db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.stripePriceIdMonthly, priceId),
  });
}

async function getFreeTier() {
  return db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.code, "free"),
  });
}

function getSubIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const subDetails = invoice.parent?.subscription_details;
  if (!subDetails) return null;
  return typeof subDetails.subscription === "string"
    ? subDetails.subscription
    : subDetails.subscription?.id ?? null;
}

/**
 * Admin-notify that a user just became a paying subscriber. Resolves the
 * user + tier from the DB so the email has human-readable context. Wrapped
 * in its own try/catch by callers — must never block webhook processing.
 */
async function notifyAdminSubscriptionStarted(
  userId: string,
  tierId: string,
  amount?: string | null,
): Promise<void> {
  const [user, tier] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { name: true, email: true },
    }),
    db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.id, tierId),
      columns: { name: true, code: true },
    }),
  ]);
  await sendNewSubscriptionNotification({
    name: user?.name ?? null,
    email: user?.email ?? null,
    tier: tier?.name ?? tier?.code ?? null,
    amount: amount ?? null,
  });
}

// ── Webhook Handler ─────────────────────────────────────────────────

/**
 * POST /api/webhooks/stripe
 *
 * Best practices followed (per Stripe docs):
 * - Signature verification on every request
 * - subscription.created: record subscription, do NOT provision (status is incomplete)
 * - invoice.payment_succeeded: PRIMARY provisioning event (money actually collected)
 * - subscription.updated: sync status, detect cancel_at_period_end, plan changes
 * - subscription.deleted: revoke access, revert to free tier
 * - invoice.payment_failed: mark past_due (Stripe retries automatically)
 * - Idempotent handlers (set-based, not increment-based)
 *
 * Registered events:
 *   customer.deleted, customer.updated,
 *   customer.subscription.created, customer.subscription.deleted, customer.subscription.updated,
 *   invoice.finalized, invoice.paid, invoice.payment_failed, invoice.payment_succeeded,
 *   payment_intent.payment_failed, payment_intent.succeeded
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 500 },
    );
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error(
      "[Stripe Webhook] Signature verification failed:",
      safeLogError(err),
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log(
    `[Stripe Webhook] received ${event.type} id=${event.id} created=${new Date(
      event.created * 1000,
    ).toISOString()}`,
  );

  try {
    switch (event.type) {
      // ────────────────────────────────────────────────────────────────
      // SUBSCRIPTION CREATED
      //
      // Fires BEFORE the first payment is collected. Status is typically
      // "incomplete" (payment pending), "trialing", or "active" ($0 plan).
      //
      // Action: Record the subscription in DB. Do NOT provision paid access.
      // Access is granted later by invoice.payment_succeeded.
      // ────────────────────────────────────────────────────────────────
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = getCustomerId(sub);
        const userId = await resolveUserId(stripe, sub, customerId);

        if (!userId) {
          console.error(
            "[Stripe] subscription.created: cannot resolve userId",
            { subId: sub.id, customerId },
          );
          break;
        }

        const { priceId, periodStart, periodEnd } = getSubPeriod(sub);
        const tier = await findTierByPrice(priceId);

        if (!tier) {
          console.error("[Stripe] No tier for price:", priceId);
          break;
        }

        // Map the actual Stripe status — do NOT assume "active"
        const mappedStatus = STATUS_MAP[sub.status] ?? sub.status;

        const existing = await db.query.userSubscriptions.findFirst({
          where: eq(userSubscriptions.userId, userId),
        });

        const subData = {
          pricingTierId: tier.id,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          status: mappedStatus,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          canceledAt: null,
          updatedAt: new Date(),
        };

        if (existing) {
          await db
            .update(userSubscriptions)
            .set(subData)
            .where(eq(userSubscriptions.id, existing.id));
        } else {
          await db.insert(userSubscriptions).values({ userId, ...subData });
        }

        // Only fire funnel event if already active (e.g. $0 plan or trialing)
        if (sub.status === "active" || sub.status === "trialing") {
          try {
            await onFunnelEvent(userId, FunnelEvents.SUBSCRIPTION_STARTED);
          } catch {}
          try {
            await notifyAdminSubscriptionStarted(userId, tier.id);
          } catch (err) {
            console.error(
              "[Stripe] admin subscription notification failed:",
              safeLogError(err),
            );
          }
        }

        break;
      }

      // ────────────────────────────────────────────────────────────────
      // SUBSCRIPTION UPDATED
      //
      // Fires on ANY subscription change: status transitions, plan changes,
      // cancel_at_period_end toggled, trial ending, renewal, etc.
      //
      // Action: Sync status and period to our DB. This is the authority
      // for status transitions like incomplete→active, active→past_due,
      // active→canceled, past_due→active (retry succeeded), etc.
      // ────────────────────────────────────────────────────────────────
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;

        const userSub = await db.query.userSubscriptions.findFirst({
          where: eq(userSubscriptions.stripeSubscriptionId, sub.id),
        });

        if (!userSub) {
          // Subscription not in our DB — might have been created externally.
          // Try to resolve and create.
          const customerId = getCustomerId(sub);
          const userId = await resolveUserId(stripe, sub, customerId);
          if (userId) {
            const { priceId, periodStart, periodEnd } = getSubPeriod(sub);
            const tier = await findTierByPrice(priceId);
            if (tier) {
              await db
                .insert(userSubscriptions)
                .values({
                  userId,
                  pricingTierId: tier.id,
                  stripeCustomerId: customerId,
                  stripeSubscriptionId: sub.id,
                  status: STATUS_MAP[sub.status] ?? sub.status,
                  currentPeriodStart: periodStart,
                  currentPeriodEnd: periodEnd,
                })
                .onConflictDoUpdate({
                  target: userSubscriptions.userId,
                  set: {
                    pricingTierId: tier.id,
                    stripeCustomerId: customerId,
                    stripeSubscriptionId: sub.id,
                    status: STATUS_MAP[sub.status] ?? sub.status,
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    updatedAt: new Date(),
                  },
                });
            }
          }
          break;
        }

        const mappedStatus = STATUS_MAP[sub.status] ?? sub.status;
        const { priceId, periodStart, periodEnd } = getSubPeriod(sub);

        // Detect plan changes
        let newTierId: string | undefined;
        if (priceId) {
          const newTier = await findTierByPrice(priceId);
          if (newTier && newTier.id !== userSub.pricingTierId) {
            newTierId = newTier.id;
          }
        }

        // Detect cancel_at_period_end — subscription is still active but
        // user scheduled cancellation. We keep status "active" but could
        // show a warning in the UI via this field.
        const cancelAt = sub.cancel_at_period_end
          ? (periodEnd ?? new Date())
          : null;

        await db
          .update(userSubscriptions)
          .set({
            status: mappedStatus,
            ...(newTierId ? { pricingTierId: newTierId } : {}),
            currentPeriodStart: periodStart ?? undefined,
            currentPeriodEnd: periodEnd ?? undefined,
            // If user scheduled cancellation, mark canceledAt with period end.
            // If they un-canceled, clear it.
            canceledAt: sub.cancel_at_period_end ? cancelAt : null,
            updatedAt: new Date(),
          })
          .where(eq(userSubscriptions.id, userSub.id));

        // Fire funnel event when transitioning to active (first payment
        // succeeded, causing incomplete → active)
        const wasNotActive = userSub.status !== "active";
        if (wasNotActive && mappedStatus === "active") {
          try {
            await onFunnelEvent(
              userSub.userId,
              FunnelEvents.SUBSCRIPTION_STARTED,
            );
          } catch {}
          try {
            await notifyAdminSubscriptionStarted(
              userSub.userId,
              newTierId ?? userSub.pricingTierId,
            );
          } catch (err) {
            console.error(
              "[Stripe] admin subscription notification failed:",
              safeLogError(err),
            );
          }
        }

        // Handle cancellation status
        if (
          mappedStatus === "canceled" &&
          userSub.status !== "canceled"
        ) {
          // Revert to free tier
          const freeTier = await getFreeTier();
          if (freeTier) {
            await db
              .update(userSubscriptions)
              .set({ pricingTierId: freeTier.id })
              .where(eq(userSubscriptions.id, userSub.id));
          }

          try {
            await onFunnelEvent(
              userSub.userId,
              FunnelEvents.SUBSCRIPTION_CANCELLED,
            );
          } catch {}
        }

        break;
      }

      // ────────────────────────────────────────────────────────────────
      // SUBSCRIPTION DELETED
      //
      // Fires when the subscription truly ends — after cancel_at_period_end
      // takes effect, or on immediate cancellation, or incomplete_expired.
      //
      // Action: Hard revoke. Revert to free tier.
      // ────────────────────────────────────────────────────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        const userSub = await db.query.userSubscriptions.findFirst({
          where: eq(userSubscriptions.stripeSubscriptionId, sub.id),
        });

        if (!userSub) break;

        const freeTier = await getFreeTier();

        await db
          .update(userSubscriptions)
          .set({
            status: "canceled",
            canceledAt: new Date(),
            pricingTierId: freeTier?.id ?? userSub.pricingTierId,
            stripeSubscriptionId: null,
            currentPeriodStart: null,
            currentPeriodEnd: null,
            updatedAt: new Date(),
          })
          .where(eq(userSubscriptions.id, userSub.id));

        try {
          await onFunnelEvent(
            userSub.userId,
            FunnelEvents.SUBSCRIPTION_CANCELLED,
          );
        } catch {}

        break;
      }

      // ────────────────────────────────────────────────────────────────
      // INVOICE PAYMENT SUCCEEDED
      //
      // PRIMARY PROVISIONING EVENT. This is the authoritative signal that
      // money was collected. Fires for first payment AND all renewals.
      //
      // Action: Activate subscription / extend access period.
      // ────────────────────────────────────────────────────────────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = getSubIdFromInvoice(invoice);
        if (!subId) break;

        const userSub = await db.query.userSubscriptions.findFirst({
          where: eq(userSubscriptions.stripeSubscriptionId, subId),
        });

        if (!userSub) break;

        // Set status to active — handles:
        // - First payment: incomplete → active
        // - Retry success: past_due → active
        // - Renewal: active → active (idempotent)
        await db
          .update(userSubscriptions)
          .set({
            status: "active",
            canceledAt: null, // Clear any pending cancellation from failed payment
            updatedAt: new Date(),
          })
          .where(eq(userSubscriptions.id, userSub.id));

        // Fire funnel event only on first activation
        if (userSub.status !== "active") {
          try {
            await onFunnelEvent(
              userSub.userId,
              FunnelEvents.SUBSCRIPTION_STARTED,
            );
          } catch {}
          try {
            const amount =
              typeof invoice.amount_paid === "number" && invoice.currency
                ? `${(invoice.amount_paid / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`
                : null;
            await notifyAdminSubscriptionStarted(
              userSub.userId,
              userSub.pricingTierId,
              amount,
            );
          } catch (err) {
            console.error(
              "[Stripe] admin subscription notification failed:",
              safeLogError(err),
            );
          }
        }

        break;
      }

      // ────────────────────────────────────────────────────────────────
      // INVOICE PAID — studio receipt generation.
      //
      // Fires alongside invoice.payment_succeeded for the same collected
      // payment. We handle it separately to act as the operator's own studio
      // generate an outbound TAX_INVOICE_RECEIPT for the paying subscriber
      // via the public REST API (Authorization: Bearer STUDIO_API_KEY).
      // Gated by STUDIO_RECEIPT_MODE and fully isolated in its own try/catch so
      // a studio-side failure never fails the webhook response back to Stripe.
      // ────────────────────────────────────────────────────────────────
      case "invoice.paid": {
        const mode = getStudioReceiptMode();
        if (mode === "off") break;

        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.id) break;

        const amountPaid =
          typeof invoice.amount_paid === "number" ? invoice.amount_paid : 0;
        if (amountPaid <= 0) break;

        const subId = getSubIdFromInvoice(invoice);
        if (!subId) break; // only subscription invoices

        try {
          const userSub = await db.query.userSubscriptions.findFirst({
            where: eq(userSubscriptions.stripeSubscriptionId, subId),
          });
          if (!userSub) break;

          const user = await db.query.users.findFirst({
            where: eq(users.id, userSub.userId),
          });
          if (!user) break;

          const tier = await db.query.pricingTiers.findFirst({
            where: eq(pricingTiers.id, userSub.pricingTierId),
          });

          const customerTaxId =
            invoice.customer_tax_ids?.find((t) => t.value)?.value ?? null;

          const paidAtUnix =
            invoice.status_transitions?.paid_at ?? invoice.created;
          const paidDate = new Date(paidAtUnix * 1000)
            .toISOString()
            .slice(0, 10);

          const result = await createStudioReceiptForStripeInvoice({
            origin: getPublicAppOrigin(request),
            customer: {
              name: user.companyName || user.name || user.email,
              email: user.email,
              taxId: customerTaxId,
            },
            planName: tier?.name ?? "Subscription",
            grossAmount: amountPaid / 100,
            currency: invoice.currency ?? "usd",
            paidDate,
            stripeInvoiceId: invoice.id,
            mode,
          });

          console.log(
            `[Stripe] studio receipt ${
              result.issued ? "issued" : "drafted"
            } invoice=${result.invoiceId} for stripe=${invoice.id}`,
          );
        } catch (err) {
          console.error(
            "[Stripe] studio receipt generation failed:",
            safeLogError(err),
          );
        }

        break;
      }

      // ────────────────────────────────────────────────────────────────
      // INVOICE PAYMENT FAILED
      //
      // Fires on every failed payment attempt (initial + retries).
      // Stripe retries automatically (Smart Retries, up to ~4 attempts).
      //
      // Action: Mark past_due. Do NOT revoke access immediately — Stripe
      // will retry. Access is only revoked when subscription status
      // becomes "unpaid" or "canceled" (via subscription.updated/deleted).
      // ────────────────────────────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = getSubIdFromInvoice(invoice);
        if (!subId) break;

        const userSub = await db.query.userSubscriptions.findFirst({
          where: eq(userSubscriptions.stripeSubscriptionId, subId),
        });

        if (userSub && userSub.status === "active") {
          // Only downgrade from active to past_due, don't overwrite
          // a worse status like "canceled"
          await db
            .update(userSubscriptions)
            .set({ status: "past_due", updatedAt: new Date() })
            .where(eq(userSubscriptions.id, userSub.id));
        }

        break;
      }

      // ────────────────────────────────────────────────────────────────
      // CUSTOMER DELETED
      //
      // Hard termination — customer and all subscriptions removed from
      // Stripe. Revoke everything.
      // ────────────────────────────────────────────────────────────────
      case "customer.deleted": {
        const customer = event.data.object as Stripe.Customer;

        const userSub = await db.query.userSubscriptions.findFirst({
          where: eq(userSubscriptions.stripeCustomerId, customer.id),
        });

        if (userSub) {
          const freeTier = await getFreeTier();

          await db
            .update(userSubscriptions)
            .set({
              status: "free",
              stripeCustomerId: null,
              stripeSubscriptionId: null,
              pricingTierId: freeTier?.id ?? userSub.pricingTierId,
              currentPeriodStart: null,
              currentPeriodEnd: null,
              canceledAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(userSubscriptions.id, userSub.id));
        }

        break;
      }

      // ────────────────────────────────────────────────────────────────
      // CUSTOMER UPDATED — informational, no action needed.
      // Our user DB is the source of truth for name/email.
      // ────────────────────────────────────────────────────────────────
      case "customer.updated":
        break;

      // ────────────────────────────────────────────────────────────────
      // INVOICE FINALIZED — informational. Invoice is locked and ready
      // for payment. Useful for accounting/tax integration.
      // ────────────────────────────────────────────────────────────────
      case "invoice.finalized":
        break;

      // ────────────────────────────────────────────────────────────────
      // PAYMENT INTENT EVENTS — lower-level primitives. For subscriptions
      // use the invoice events above. These are only needed for one-time
      // payments or detecting 3DS authentication requirements.
      // ────────────────────────────────────────────────────────────────
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[Stripe Webhook] Processing error:", safeLogError(err));
    return NextResponse.json(
      { error: "Processing error" },
      { status: 500 },
    );
  }
}
