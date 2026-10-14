"use server";

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  ENTITY_TYPES,
  SPONSOR_CATEGORIES,
  SPONSOR_IMAGE_MAX_BYTES,
  SPONSOR_PLACEMENTS,
  SPONSOR_SHARED_FIELDS,
  SPONSOR_TRIGGERS,
  sponsorCampaignImages,
  sponsorCampaigns,
  sponsorEvents,
  users,
  type SponsorCategory,
  type SponsorCopy,
  type SponsorImageType,
  type SponsorPlacement,
  type SponsorSharedField,
  type SponsorTrigger,
} from "@/db/schema";
import type { EntityType } from "@/db/schema/business-entities";
import { isUserAdmin } from "@/lib/is-user-admin";
import { sponsorImageUrl } from "@/lib/sponsors/image-url";

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return (await isUserAdmin(session.user.id)) ? session.user.id : null;
}

/** Stats window shown next to each campaign. */
const STATS_DAYS = 30;

export interface AdminSponsorCampaign {
  id: string;
  partnerName: string;
  partnerMark: string;
  category: SponsorCategory;
  placement: SponsorPlacement;
  /** Same-origin image URL, or null when the campaign has no image. */
  imageUrl: string | null;
  trigger: SponsorTrigger;
  minAmount: string | null;
  entityTypes: EntityType[] | null;
  copy: Record<string, SponsorCopy>;
  ctaUrl: string;
  sharedFields: SponsorSharedField[];
  weight: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  stats: { impressions: number; dismissals: number; leads: number };
}

export interface AdminSponsorLead {
  id: string;
  campaignId: string;
  partnerName: string;
  userEmail: string;
  sharedData: Partial<Record<SponsorSharedField, string>>;
  createdAt: string;
}

export async function getSponsorCampaigns(): Promise<AdminSponsorCampaign[]> {
  if (!(await requireAdmin())) return [];

  const since = new Date(Date.now() - STATS_DAYS * 86_400_000);
  const [rows, counts] = await Promise.all([
    db.select().from(sponsorCampaigns).orderBy(desc(sponsorCampaigns.createdAt)),
    db
      .select({
        campaignId: sponsorEvents.campaignId,
        kind: sponsorEvents.kind,
        n: sql<number>`count(*)::int`,
      })
      .from(sponsorEvents)
      .where(gte(sponsorEvents.createdAt, since))
      .groupBy(sponsorEvents.campaignId, sponsorEvents.kind),
  ]);

  const stats = new Map<string, AdminSponsorCampaign["stats"]>();
  for (const c of counts) {
    const s = stats.get(c.campaignId) ?? { impressions: 0, dismissals: 0, leads: 0 };
    if (c.kind === "impression") s.impressions = c.n;
    else if (c.kind === "dismiss") s.dismissals = c.n;
    else if (c.kind === "lead") s.leads = c.n;
    stats.set(c.campaignId, s);
  }

  return rows.map((r) => ({
    id: r.id,
    partnerName: r.partnerName,
    partnerMark: r.partnerMark,
    category: r.category,
    placement: r.placement,
    imageUrl: sponsorImageUrl(r.id, r.imageUpdatedAt),
    trigger: r.trigger,
    minAmount: r.minAmount,
    entityTypes: r.entityTypes ?? null,
    copy: r.copy,
    ctaUrl: r.ctaUrl,
    sharedFields: r.sharedFields,
    weight: r.weight,
    isActive: r.isActive,
    startsAt: r.startsAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
    stats: stats.get(r.id) ?? { impressions: 0, dismissals: 0, leads: 0 },
  }));
}

/**
 * Most recent confirmed leads. Contains the personal details each user
 * agreed to share, so it is admin-only and never cached.
 */
export async function getSponsorLeads(limit = 200): Promise<AdminSponsorLead[]> {
  if (!(await requireAdmin())) return [];
  const rows = await db
    .select({
      id: sponsorEvents.id,
      campaignId: sponsorEvents.campaignId,
      partnerName: sponsorCampaigns.partnerName,
      userEmail: users.email,
      sharedData: sponsorEvents.sharedData,
      createdAt: sponsorEvents.createdAt,
    })
    .from(sponsorEvents)
    .innerJoin(sponsorCampaigns, eq(sponsorCampaigns.id, sponsorEvents.campaignId))
    .innerJoin(users, eq(users.id, sponsorEvents.userId))
    .where(eq(sponsorEvents.kind, "lead"))
    .orderBy(desc(sponsorEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 1000));
  return rows.map((r) => ({
    ...r,
    sharedData: r.sharedData ?? {},
    createdAt: r.createdAt.toISOString(),
  }));
}

const copySchema = z.object({
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1).max(400),
  cta: z.string().trim().min(1).max(40),
});

const campaignSchema = z
  .object({
    partnerName: z.string().trim().min(1).max(120),
    partnerMark: z.string().trim().min(1).max(3),
    category: z.enum(SPONSOR_CATEGORIES),
    placement: z.enum(SPONSOR_PLACEMENTS),
    trigger: z.enum(SPONSOR_TRIGGERS),
    minAmount: z.number().nonnegative().max(1e11).nullable(),
    entityTypes: z.array(z.enum(ENTITY_TYPES)).nullable(),
    copy: z.object({ en: copySchema, he: copySchema.optional() }),
    ctaUrl: z
      .string()
      .trim()
      .url()
      .refine((u) => u.startsWith("https://"), "The partner link must start with https://"),
    sharedFields: z.array(z.enum(SPONSOR_SHARED_FIELDS)).min(1),
    weight: z.number().int().min(0).max(1000),
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
  })
  .refine((v) => v.trigger !== "everyone" || (!v.entityTypes?.length && v.minAmount == null), {
    message: "A campaign shown to everyone can't filter by business type or amount",
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.startsAt < v.endsAt, {
    message: "The end date must be after the start date",
  });

export type SponsorCampaignInput = z.input<typeof campaignSchema>;

type SaveResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Create (no `id`) or update a campaign. New campaigns are always created
 * inactive so a half-written offer can't go live by accident; activation is
 * a separate, explicit step.
 */
export async function saveSponsorCampaign(
  input: SponsorCampaignInput,
  id?: string,
): Promise<SaveResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Not allowed" };
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid campaign" };
  }
  const v = parsed.data;
  const copy: Record<string, SponsorCopy> = { en: v.copy.en };
  if (v.copy.he) copy.he = v.copy.he;

  const values = {
    partnerName: v.partnerName,
    partnerMark: v.partnerMark,
    category: v.category,
    placement: v.placement,
    trigger: v.trigger,
    minAmount: v.minAmount != null ? String(v.minAmount) : null,
    entityTypes: v.entityTypes?.length ? v.entityTypes : null,
    copy,
    ctaUrl: v.ctaUrl,
    sharedFields: [...new Set(v.sharedFields)],
    weight: v.weight,
    startsAt: v.startsAt ? new Date(v.startsAt) : null,
    endsAt: v.endsAt ? new Date(v.endsAt) : null,
  };

  let savedId: string;
  if (id) {
    const [row] = await db
      .update(sponsorCampaigns)
      .set(values)
      .where(eq(sponsorCampaigns.id, id))
      .returning({ id: sponsorCampaigns.id });
    if (!row) return { ok: false, error: "Campaign not found" };
    savedId = row.id;
  } else {
    const [row] = await db
      .insert(sponsorCampaigns)
      .values({ ...values, isActive: false })
      .returning({ id: sponsorCampaigns.id });
    savedId = row.id;
  }
  revalidatePath("/admin/sponsors");
  return { ok: true, id: savedId };
}

/**
 * Turn a campaign on or off. Campaigns are never deleted from here: their
 * events are the record of what was shown and who agreed to be contacted.
 */
export async function setSponsorCampaignActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean }> {
  if (!(await requireAdmin())) return { ok: false };
  const [row] = await db
    .update(sponsorCampaigns)
    .set({ isActive })
    .where(eq(sponsorCampaigns.id, id))
    .returning({ id: sponsorCampaigns.id });
  revalidatePath("/admin/sponsors");
  return { ok: Boolean(row) };
}

/** Identify the image from its first bytes; the browser-supplied type is not trusted. */
function sniffImageType(buf: Buffer): SponsorImageType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Set or replace a campaign's image (PNG, JPEG or WebP, up to 300 KB). */
export async function uploadSponsorImage(
  campaignId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await requireAdmin())) return { ok: false, error: "Not allowed" };
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image file" };
  }
  if (file.size > SPONSOR_IMAGE_MAX_BYTES) {
    return { ok: false, error: "The image must be 300 KB or smaller" };
  }
  const data = Buffer.from(await file.arrayBuffer());
  const contentType = sniffImageType(data);
  if (!contentType) {
    return { ok: false, error: "Use a PNG, JPEG or WebP image" };
  }

  const [campaign] = await db
    .select({ id: sponsorCampaigns.id })
    .from(sponsorCampaigns)
    .where(eq(sponsorCampaigns.id, campaignId))
    .limit(1);
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(sponsorCampaignImages)
      .values({ campaignId, contentType, data, updatedAt: now })
      .onConflictDoUpdate({
        target: sponsorCampaignImages.campaignId,
        set: { contentType, data, updatedAt: now },
      });
    await tx
      .update(sponsorCampaigns)
      .set({ imageUpdatedAt: now })
      .where(eq(sponsorCampaigns.id, campaignId));
  });
  revalidatePath("/admin/sponsors");
  return { ok: true };
}

export async function removeSponsorImage(campaignId: string): Promise<{ ok: boolean }> {
  if (!(await requireAdmin())) return { ok: false };
  await db.transaction(async (tx) => {
    await tx
      .delete(sponsorCampaignImages)
      .where(eq(sponsorCampaignImages.campaignId, campaignId));
    await tx
      .update(sponsorCampaigns)
      .set({ imageUpdatedAt: null })
      .where(eq(sponsorCampaigns.id, campaignId));
  });
  revalidatePath("/admin/sponsors");
  return { ok: true };
}

/**
 * Delete one confirmed lead. The user then becomes eligible for that
 * campaign again, which is what makes an offer re-testable. The lead is
 * also the record of what the user agreed to share, so only remove leads
 * that were never passed to the partner (tests, mistakes).
 */
export async function deleteSponsorLead(leadId: string): Promise<{ ok: boolean }> {
  if (!(await requireAdmin())) return { ok: false };
  const [row] = await db
    .delete(sponsorEvents)
    .where(and(eq(sponsorEvents.id, leadId), eq(sponsorEvents.kind, "lead")))
    .returning({ id: sponsorEvents.id });
  revalidatePath("/admin/sponsors");
  return { ok: Boolean(row) };
}
