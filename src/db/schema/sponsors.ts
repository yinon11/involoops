import {
  customType,
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import type { EntityType } from "./business-entities";

export const SPONSOR_CATEGORIES = [
  "accountant",
  "financing",
  "banking",
  "insurance",
  "vendor",
  "payroll",
] as const;
export type SponsorCategory = (typeof SPONSOR_CATEGORIES)[number];

/**
 * Where an offer is shown. Each placement is sold separately, and a campaign
 * runs in exactly one, so a user never sees the same offer twice on a page.
 *
 * - `dashboard` — a card on the home dashboard, under "Needs attention".
 * - `header`    — a compact pill in the top bar of every app page (a slim
 *                 second row of the bar on phones).
 * - `banner`    — a full-width banner between dashboard sections, with image.
 */
export const SPONSOR_PLACEMENTS = ["dashboard", "header", "banner"] as const;
export type SponsorPlacement = (typeof SPONSOR_PLACEMENTS)[number];

/**
 * What makes a campaign eligible for a user.
 *
 * - `everyone`             — every user, with nothing about them consulted
 *                            (no figures, business type or accountant check).
 *                            The only kind shown to users who opted out of
 *                            offer matching.
 *
 * - `no_accountant`        — nobody holds an accountant role on the business.
 * - `overdue_receivables`  — open receivables ≥ `minAmount` (ILS).
 * - `vat_due`              — VAT to set aside this month ≥ `minAmount` (ILS).
 * - `revenue_ytd`          — year-to-date revenue ≥ `minAmount` (ILS). Used
 *                            e.g. for "approaching the Osek Patur ceiling";
 *                            the operator sets the threshold, so a yearly
 *                            change to the ceiling needs no deploy.
 */
export const SPONSOR_TRIGGERS = [
  "everyone",
  "no_accountant",
  "overdue_receivables",
  "vat_due",
  "revenue_ytd",
] as const;
export type SponsorTrigger = (typeof SPONSOR_TRIGGERS)[number];

/**
 * Fields a partner may receive when the user confirms a lead. The user sees
 * the exact values before confirming; nothing outside this list is ever sent.
 */
export const SPONSOR_SHARED_FIELDS = [
  "name",
  "email",
  "phone",
  "businessName",
  "entityType",
  "openReceivables",
] as const;
export type SponsorSharedField = (typeof SPONSOR_SHARED_FIELDS)[number];

/**
 * Per-locale card copy. `{amount}` and `{days}` are filled from the signal
 * that made the campaign eligible.
 */
export interface SponsorCopy {
  title: string;
  body: string;
  cta: string;
}

/**
 * A partner's offer shown in the sponsored slot on the home dashboard.
 * Created inactive; an operator switches it on once the partner contract
 * and copy are approved.
 */
export const sponsorCampaigns = pgTable("sponsor_campaigns", {
  id: uuid().primaryKey().defaultRandom(),
  partnerName: text("partner_name").notNull(),
  /** One to three characters drawn as the partner's mark. */
  partnerMark: text("partner_mark").notNull(),
  category: text("category", { enum: SPONSOR_CATEGORIES }).notNull(),
  placement: text("placement", { enum: SPONSOR_PLACEMENTS })
    .notNull()
    .default("dashboard"),
  trigger: text("trigger", { enum: SPONSOR_TRIGGERS }).notNull(),
  /** Threshold for amount-based triggers, in ILS. Ignored by `no_accountant`. */
  minAmount: numeric("min_amount", { precision: 14, scale: 2 }),
  /** Restrict to these entity types; null = any. */
  entityTypes: jsonb("entity_types").$type<EntityType[] | null>(),
  copy: jsonb("copy").$type<Record<string, SponsorCopy>>().notNull(),
  /** Where the user goes after confirming. */
  ctaUrl: text("cta_url").notNull(),
  sharedFields: jsonb("shared_fields").$type<SponsorSharedField[]>().notNull(),
  /** Higher wins when several campaigns are eligible. */
  weight: integer("weight").notNull().default(0),
  isActive: boolean("is_active").notNull().default(false),
  /**
   * When the campaign's image last changed; null = no image. Doubles as the
   * cache-busting version in the image URL. The bytes live in
   * `sponsor_campaign_images` so campaign queries never drag them along.
   */
  imageUpdatedAt: timestamp("image_updated_at", { withTimezone: true }),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Image types accepted for campaign artwork. No SVG: it can carry script. */
export const SPONSOR_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type SponsorImageType = (typeof SPONSOR_IMAGE_TYPES)[number];
export const SPONSOR_IMAGE_MAX_BYTES = 300 * 1024;

/**
 * A campaign's artwork, served from this app's own origin
 * (`/api/sponsors/image/<id>`). Hot-linking the partner's URL instead would
 * tell the partner every time a user opens a page, which the offer promises
 * it does not.
 */
export const sponsorCampaignImages = pgTable("sponsor_campaign_images", {
  campaignId: uuid("campaign_id")
    .primaryKey()
    .references(() => sponsorCampaigns.id, { onDelete: "cascade" }),
  contentType: text("content_type", { enum: SPONSOR_IMAGE_TYPES }).notNull(),
  data: bytea("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const SPONSOR_EVENT_KINDS = ["impression", "dismiss", "lead"] as const;
export type SponsorEventKind = (typeof SPONSOR_EVENT_KINDS)[number];

/**
 * What happened to a campaign for a user. Impressions and leads are what
 * partners are billed on; dismissals suppress the campaign for that user.
 * A lead row keeps a snapshot of exactly what the user agreed to share.
 */
export const sponsorEvents = pgTable(
  "sponsor_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => sponsorCampaigns.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SPONSOR_EVENT_KINDS }).notNull(),
    sharedData: jsonb("shared_data").$type<Partial<Record<SponsorSharedField, string>> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sponsor_events_user_campaign_idx").on(t.userId, t.campaignId, t.kind),
    index("sponsor_events_campaign_kind_idx").on(t.campaignId, t.kind, t.createdAt),
  ],
);

export const sponsorCampaignsRelations = relations(sponsorCampaigns, ({ many }) => ({
  events: many(sponsorEvents),
}));

export const sponsorEventsRelations = relations(sponsorEvents, ({ one }) => ({
  user: one(users, { fields: [sponsorEvents.userId], references: [users.id] }),
  campaign: one(sponsorCampaigns, {
    fields: [sponsorEvents.campaignId],
    references: [sponsorCampaigns.id],
  }),
}));
