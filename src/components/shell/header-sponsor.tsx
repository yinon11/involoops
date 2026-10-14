import { auth } from "@/auth";
import { getCollectionsDashboardData } from "@/features/generator/actions/collections-actions";
import { getTaxEstimationData } from "@/features/generator/actions/tax-actions";
import { getUserDisplayCurrency } from "@/lib/display-currency";
import { getLocale } from "@/lib/i18n/server";
import {
  hasLiveSponsorCampaigns,
  recordSponsorImpression,
  selectSponsoredOffer,
} from "@/lib/sponsors/select";
import { HeaderSponsorSlot } from "./header-sponsor-slot";

/**
 * The top-bar sponsored slot, streamed in after the bar itself so it never
 * delays a page.
 *
 * The business's numbers are only gathered when a header campaign is live;
 * the shell is rendered once per full page load (client-side navigation
 * keeps it), so this costs one pass per visit, not one per click.
 */
export async function HeaderSponsor() {
  const session = await auth();
  const userId = session?.user?.id;
  // Same rule as the dashboard card: never while acting as someone else.
  if (!userId || session.user.originator) return null;
  if (!(await hasLiveSponsorCampaigns("header"))) return null;

  const now = new Date();
  const monthIndex = now.getMonth();
  const [locale, currency, collections, tax] = await Promise.all([
    getLocale(),
    getUserDisplayCurrency(userId),
    getCollectionsDashboardData().catch(() => null),
    getTaxEstimationData(now.getFullYear(), { convertToDisplayCurrency: true }).catch(
      () => null,
    ),
  ]);
  const monthly = tax?.monthly ?? [];

  const offer = await selectSponsoredOffer(userId, locale, "header", {
    currency,
    openReceivables: collections?.openTotal ?? 0,
    oldestOpenDays: collections?.agingRows[0]?.daysOutstanding ?? 0,
    vatDue: monthly[monthIndex]?.vatDue ?? 0,
    revenueYtd: monthly
      .slice(0, monthIndex + 1)
      .reduce((sum, m) => sum + m.grossRevenue, 0),
  }).catch(() => null);
  if (!offer) return null;

  void recordSponsorImpression(userId, offer.campaignId);
  return <HeaderSponsorSlot offer={offer} />;
}
