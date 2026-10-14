"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/db";
import { sponsorCampaigns, sponsorEvents, users } from "@/db/schema";
import { getCollectionsDashboardData } from "@/features/generator/actions/collections-actions";
import { getUserDisplayCurrency } from "@/lib/display-currency";
import { buildSharedData } from "@/lib/sponsors/select";
import { areSponsorsEnabled } from "@/lib/sponsors/enabled";

/**
 * Sponsor events belong to the account owner. A teammate, accountant or
 * admin acting as the owner must never become a lead in the owner's name,
 * so every action requires the owner's own login.
 */
async function requireOwnUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (session.user.originator) throw new Error("Not available while acting as another account");
  return session.user.id;
}

async function getActiveCampaign(campaignId: string) {
  const [campaign] = await db
    .select()
    .from(sponsorCampaigns)
    .where(and(eq(sponsorCampaigns.id, campaignId), eq(sponsorCampaigns.isActive, true)))
    .limit(1);
  return campaign ?? null;
}

/** Hide this partner's offer for the user (suppressed for 90 days). */
export async function dismissSponsoredOffer(campaignId: string): Promise<void> {
  const userId = await requireOwnUserId();
  const campaign = await getActiveCampaign(campaignId);
  if (!campaign) return;
  await db.insert(sponsorEvents).values({ userId, campaignId, kind: "dismiss" });
}

/**
 * The user confirmed sharing their details with the partner.
 *
 * The payload is rebuilt on the server from the campaign's field list; the
 * client sends only the campaign id, so it cannot widen what is shared. The
 * snapshot stored on the event is the record of what the user agreed to.
 */
export async function confirmSponsorLead(
  campaignId: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  const userId = await requireOwnUserId();
  if (!areSponsorsEnabled()) return { ok: false };
  const campaign = await getActiveCampaign(campaignId);
  if (!campaign) return { ok: false };

  const [existing] = await db
    .select({ id: sponsorEvents.id })
    .from(sponsorEvents)
    .where(
      and(
        eq(sponsorEvents.userId, userId),
        eq(sponsorEvents.campaignId, campaignId),
        eq(sponsorEvents.kind, "lead"),
      ),
    )
    .limit(1);
  // Only ever send the user to a secure partner page.
  if (!campaign.ctaUrl.startsWith("https://")) return { ok: false };
  if (existing) return { ok: true, url: campaign.ctaUrl };

  let signals: { currency: string; openReceivables: number } | undefined;
  if (campaign.sharedFields.includes("openReceivables")) {
    const [collections, currency] = await Promise.all([
      getCollectionsDashboardData().catch(() => null),
      getUserDisplayCurrency(userId),
    ]);
    signals = { currency, openReceivables: collections?.openTotal ?? 0 };
  }
  const shared = await buildSharedData(userId, campaign.sharedFields, signals);

  await db.insert(sponsorEvents).values({
    userId,
    campaignId,
    kind: "lead",
    sharedData: Object.fromEntries(shared.map((s) => [s.field, s.value])),
  });
  return { ok: true, url: campaign.ctaUrl };
}

/**
 * Object to, or allow again, using the user's figures to choose sponsored
 * offers. Objecting leaves only offers shown to everyone.
 * Only on the owner's own login: it is the owner's right to exercise.
 */
export async function setSponsorTargetingOptOut(optOut: boolean): Promise<{ ok: boolean }> {
  const userId = await requireOwnUserId();
  await db
    .update(users)
    .set({ sponsorTargetingOptOut: optOut, sponsorTargetingOptOutAt: new Date() })
    .where(eq(users.id, userId));
  revalidatePath("/", "layout");
  return { ok: true };
}
