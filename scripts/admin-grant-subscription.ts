/**
 * Manually grant a paid pricing tier to a user (no Stripe round-trip),
 * then fire the SUBSCRIPTION_STARTED funnel event so conversion funnels
 * (4.1 Approaching Limit, 4.2 Limit Reached) exit cleanly.
 *
 * The Stripe webhook is the *only* place that fires SUBSCRIPTION_STARTED,
 * so a direct UPDATE on `user_subscriptions` leaves users stuck inside
 * "Limit Reached" for weeks (next_email_at keeps getting rescheduled by
 * the staleness guard in `/api/cron/funnel-emails`). Always upgrade
 * non-Stripe accounts through this script instead of raw SQL.
 *
 * Usage:
 *   npx tsx scripts/admin-grant-subscription.ts <email> <tierCode> [--months=N]
 *
 * Examples:
 *   npx tsx scripts/admin-grant-subscription.ts owner@example.com enterprise
 *   npx tsx scripts/admin-grant-subscription.ts owner@example.com professional --months=3
 *
 * Defaults: 12 months.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { users } from "../src/db/schema/users";
import { pricingTiers } from "../src/db/schema/pricing-tiers";
import { userSubscriptions } from "../src/db/schema/user-subscriptions";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error(
    "Usage: npx tsx scripts/admin-grant-subscription.ts <email> <tierCode> [--months=N]",
  );
  process.exit(1);
}

const [email, tierCode, ...rest] = args;
let months = 12;
for (const a of rest) {
  const m = a.match(/^--months=(\d+)$/);
  if (m) months = Number(m[1]);
}

async function main() {
  const client = postgres(connectionString!);
  const db = drizzle(client, { schema });

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const tier = await db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.code, tierCode),
  });
  if (!tier) {
    console.error(`Pricing tier not found: ${tierCode}`);
    process.exit(1);
  }

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + months);

  const existing = await db.query.userSubscriptions.findFirst({
    where: eq(userSubscriptions.userId, user.id),
  });

  const wasActive = existing?.status === "active";

  if (existing) {
    await db
      .update(userSubscriptions)
      .set({
        pricingTierId: tier.id,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        canceledAt: null,
        updatedAt: now,
      })
      .where(eq(userSubscriptions.id, existing.id));
    console.log(
      `Updated subscription for ${email} → ${tier.code} (${tier.name}), active through ${periodEnd.toISOString()}`,
    );
  } else {
    await db.insert(userSubscriptions).values({
      userId: user.id,
      pricingTierId: tier.id,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    });
    console.log(
      `Inserted subscription for ${email} → ${tier.code} (${tier.name}), active through ${periodEnd.toISOString()}`,
    );
  }

  // Fire the funnel event the Stripe webhook would normally fire. This is
  // what lets active conversion funnels (PLAN_LIMIT_APPROACHING / REACHED)
  // exit via their SUBSCRIPTION_STARTED exit condition. Skip when the row
  // was already active to avoid re-entering Subscription-Started flows.
  if (wasActive) {
    console.log(
      "Subscription was already active — not firing SUBSCRIPTION_STARTED.",
    );
  } else {
    // Lazy-load to avoid pulling Next-only modules at script boot.
    const { onFunnelEvent } = await import("../src/lib/email/funnel-event-service");
    const { FunnelEvents } = await import("../src/lib/email/funnel-constants");
    try {
      await onFunnelEvent(user.id, FunnelEvents.SUBSCRIPTION_STARTED);
      console.log("Fired SUBSCRIPTION_STARTED funnel event.");
    } catch (err) {
      console.error("Failed to fire SUBSCRIPTION_STARTED event:", err);
    }
  }

  await client.end();
  console.log("Done.");
  // The funnel event service keeps its own `@/db` pool open; force-exit
  // so the script doesn't hang waiting for that pool to time out.
  process.exit(0);
}

main().catch((err) => {
  console.error("admin-grant-subscription failed:", err);
  process.exit(1);
});
