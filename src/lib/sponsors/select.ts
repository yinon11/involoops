import "server-only";

import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  accountLinks,
  businessEntityMembers,
  sponsorCampaigns,
  sponsorEvents,
  users,
  type SponsorCategory,
  type SponsorPlacement,
  type SponsorSharedField,
  type SponsorTrigger,
} from "@/db/schema";
import { convertAmountBetweenCurrencies } from "@/lib/fx";
import { format } from "@/lib/i18n/format";
import { formatCurrencyCompact as formatMoney } from "@/lib/currency";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { areSponsorsEnabled } from "./enabled";
import { sponsorImageUrl } from "./image-url";

/** A dismissed campaign stays hidden from that user for this long. */
const DISMISS_SUPPRESS_DAYS = 90;

/**
 * What the home dashboard already knows about the business, in the user's
 * display currency. The selector converts to ILS before comparing against
 * campaign thresholds.
 */
export interface SponsorSignals {
  currency: string;
  openReceivables: number;
  oldestOpenDays: number;
  vatDue: number;
  revenueYtd: number;
}

export interface SponsoredOffer {
  campaignId: string;
  partnerName: string;
  partnerMark: string;
  /** Same-origin artwork URL, or null to fall back to the partner mark. */
  imageUrl: string | null;
  /**
   * The partner's landing page. Safe to hand the client: it is a public URL,
   * already constrained to https above. Navigating here shares nothing about
   * the user — that only happens through `confirmSponsorLead`.
   */
  ctaUrl: string;
  category: SponsorCategory;
  trigger: SponsorTrigger;
  title: string;
  body: string;
  cta: string;
  /** Values for the "why am I seeing this" line, already formatted. */
  reasonVars: Record<string, string | number>;
  /** Exactly what the partner receives if the user confirms. */
  sharedPreview: { field: SponsorSharedField; value: string }[];
}

/** Accountant offers are pointless to a business that already has one. */
async function hasAccountant(userId: string, entityId: string | null): Promise<boolean> {
  if (entityId) {
    const [member] = await db
      .select({ id: businessEntityMembers.id })
      .from(businessEntityMembers)
      .where(
        and(
          eq(businessEntityMembers.businessEntityId, entityId),
          eq(businessEntityMembers.role, "ACCOUNTANT"),
        ),
      )
      .limit(1);
    if (member) return true;
  }
  // Someone acting on this account from their own login is, in practice,
  // almost always the bookkeeper or accountant. Err on not pitching one.
  const [link] = await db
    .select({ id: accountLinks.id })
    .from(accountLinks)
    .where(eq(accountLinks.managedUserId, userId))
    .limit(1);
  return Boolean(link);
}

function liveCampaignsIn(placement: SponsorPlacement, now: Date) {
  return and(
    eq(sponsorCampaigns.isActive, true),
    eq(sponsorCampaigns.placement, placement),
    or(isNull(sponsorCampaigns.startsAt), lte(sponsorCampaigns.startsAt, now)),
    or(isNull(sponsorCampaigns.endsAt), gte(sponsorCampaigns.endsAt, now)),
  );
}

/**
 * Whether any campaign is live in this placement. One indexed lookup, so a
 * caller can skip gathering the business's numbers when nothing could show.
 */
export async function hasLiveSponsorCampaigns(
  placement: SponsorPlacement,
): Promise<boolean> {
  if (!areSponsorsEnabled()) return false;
  const [row] = await db
    .select({ id: sponsorCampaigns.id })
    .from(sponsorCampaigns)
    .where(liveCampaignsIn(placement, new Date()))
    .limit(1);
  return Boolean(row);
}

/**
 * Pick at most one sponsored offer for this user, or null.
 *
 * Nothing is shown when sponsors are switched off, or when no active
 * campaign's trigger holds for this business.
 * There is deliberately no fallback inventory: an offer that isn't about
 * the user's own numbers is just an ad.
 */
export async function selectSponsoredOffer(
  userId: string,
  locale: string,
  placement: SponsorPlacement,
  signals: SponsorSignals,
): Promise<SponsoredOffer | null> {
  if (!areSponsorsEnabled()) return null;

  // A user who objected to offer matching only gets campaigns shown to
  // everyone, which consult nothing about them.
  const [prefs] = await db
    .select({ optOut: users.sponsorTargetingOptOut })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!prefs) return null;
  const untargetedOnly = prefs.optOut;

  const now = new Date();
  const campaigns = await db
    .select()
    .from(sponsorCampaigns)
    .where(liveCampaignsIn(placement, now))
    .orderBy(desc(sponsorCampaigns.weight), desc(sponsorCampaigns.createdAt));
  if (campaigns.length === 0) return null;

  // Hide what the user dismissed recently, and anything they already became
  // a lead for (asking twice is noise to them and a duplicate bill to us).
  const suppressSince = new Date(now.getTime() - DISMISS_SUPPRESS_DAYS * 86_400_000);
  const past = await db
    .select({
      campaignId: sponsorEvents.campaignId,
      kind: sponsorEvents.kind,
      createdAt: sponsorEvents.createdAt,
    })
    .from(sponsorEvents)
    .where(
      and(
        eq(sponsorEvents.userId, userId),
        inArray(sponsorEvents.kind, ["dismiss", "lead"]),
        inArray(
          sponsorEvents.campaignId,
          campaigns.map((c) => c.id),
        ),
      ),
    );
  const suppressed = new Set(
    past
      .filter((e) => e.kind === "lead" || e.createdAt >= suppressSince)
      .map((e) => e.campaignId),
  );

  const entity = await getBusinessEntityForUserOrNull(userId);
  const toIls = (n: number) =>
    convertAmountBetweenCurrencies(n, signals.currency, "ILS");
  const ils = {
    openReceivables: toIls(signals.openReceivables),
    vatDue: toIls(signals.vatDue),
    revenueYtd: toIls(signals.revenueYtd),
  };

  let accountantKnown: boolean | null = null;
  const accountantPresent = async () =>
    (accountantKnown ??= await hasAccountant(userId, entity?.id ?? null));

  for (const c of campaigns) {
    if (suppressed.has(c.id)) continue;
    if (!c.ctaUrl.startsWith("https://")) continue;
    const copy = c.copy[locale] ?? c.copy.en;
    if (!copy) continue;

    if (c.trigger === "everyone") {
      // Nothing about the user is consulted, and nothing about them is
      // interpolated into the copy.
      const vars = { amount: "", days: "" };
      return {
        campaignId: c.id,
        partnerName: c.partnerName,
        partnerMark: c.partnerMark.slice(0, 3),
        imageUrl: sponsorImageUrl(c.id, c.imageUpdatedAt),
        ctaUrl: c.ctaUrl,
        category: c.category,
        trigger: c.trigger,
        title: format(copy.title, vars),
        body: format(copy.body, vars),
        cta: copy.cta,
        reasonVars: vars,
        sharedPreview: await buildSharedData(userId, c.sharedFields, signals),
      };
    }
    if (untargetedOnly) continue;

    if (c.entityTypes?.length && (!entity || !c.entityTypes.includes(entity.entityType))) {
      continue;
    }

    const min = c.minAmount != null ? Number(c.minAmount) : 0;
    let amount: number | null = null;
    switch (c.trigger) {
      case "no_accountant":
        if (await accountantPresent()) continue;
        break;
      case "overdue_receivables":
        if (ils.openReceivables <= 0 || ils.openReceivables < min) continue;
        amount = signals.openReceivables;
        break;
      case "vat_due":
        if (ils.vatDue <= 0 || ils.vatDue < min) continue;
        amount = signals.vatDue;
        break;
      case "revenue_ytd":
        if (ils.revenueYtd <= 0 || ils.revenueYtd < min) continue;
        amount = signals.revenueYtd;
        break;
    }
    if (c.category === "accountant" && c.trigger !== "no_accountant" && (await accountantPresent())) {
      continue;
    }

    const vars: Record<string, string | number> = {
      amount: amount != null ? formatMoney(amount, signals.currency) : "",
      days: signals.oldestOpenDays,
    };

    return {
      campaignId: c.id,
      partnerName: c.partnerName,
      partnerMark: c.partnerMark.slice(0, 3),
      imageUrl: sponsorImageUrl(c.id, c.imageUpdatedAt),
      ctaUrl: c.ctaUrl,
      category: c.category,
      trigger: c.trigger,
      title: format(copy.title, vars),
      body: format(copy.body, vars),
      cta: copy.cta,
      reasonVars: vars,
      sharedPreview: await buildSharedData(userId, c.sharedFields, signals),
    };
  }
  return null;
}

/**
 * The partner-facing payload, computed server-side from the DB. Used both
 * for the preview the user confirms and for the snapshot stored on the lead,
 * so what is shown is what is recorded.
 */
export async function buildSharedData(
  userId: string,
  fields: SponsorSharedField[],
  signals?: Pick<SponsorSignals, "currency" | "openReceivables">,
): Promise<{ field: SponsorSharedField; value: string }[]> {
  const [user] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const entity = await getBusinessEntityForUserOrNull(userId);

  const out: { field: SponsorSharedField; value: string }[] = [];
  for (const field of fields) {
    let value: string | null | undefined;
    switch (field) {
      case "name":
        value = user?.name;
        break;
      case "email":
        value = entity?.email || user?.email;
        break;
      case "phone":
        value = entity?.phone;
        break;
      case "businessName":
        value = entity?.legalName;
        break;
      case "entityType":
        value = entity?.entityType;
        break;
      case "openReceivables":
        value =
          signals && signals.openReceivables > 0
            ? formatMoney(signals.openReceivables, signals.currency)
            : null;
        break;
    }
    if (value) out.push({ field, value });
  }
  return out;
}

/** Count one rendering of the offer. Best-effort: never breaks the page. */
export async function recordSponsorImpression(
  userId: string,
  campaignId: string,
): Promise<void> {
  await db
    .insert(sponsorEvents)
    .values({ userId, campaignId, kind: "impression" })
    .catch(() => undefined);
}
