import { db } from "@/db";
import { eq } from "drizzle-orm";
import { pricingTiers } from "@/db/schema/pricing-tiers";
import { userSubscriptions } from "@/db/schema/user-subscriptions";
import { userEmailPreferences } from "@/db/schema/user-email-preferences";
import { onFunnelEvent } from "@/lib/email/funnel-event-service";
import { FunnelEvents } from "@/lib/email/funnel-constants";

/**
 * Assign the free pricing tier, email preferences, and fire the signup funnel event.
 *
 * NOTE: A `business_entities` row is intentionally NOT created here.
 * The user creates one lazily the first time they save their business
 * details from `/creator/business-details`. Until then they can browse
 * the studio but cannot issue documents (the create-invoice form's
 * "missing osek_murshe" banner blocks submission).
 */
export async function assignFreePlan(userId: string) {
  const freeTier = await db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.code, "free"),
  });
  if (freeTier) {
    await db.insert(userSubscriptions).values({
      userId,
      pricingTierId: freeTier.id,
      status: "free",
    });
  }
  await db.insert(userEmailPreferences).values({ userId });
  await onFunnelEvent(userId, FunnelEvents.SIGNUP);
}
