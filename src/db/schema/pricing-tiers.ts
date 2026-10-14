import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const pricingTiers = pgTable("pricing_tiers", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 100 }).notNull(),
  code: varchar({ length: 50 }).unique().notNull(),
  maxInvoicesPerMonth: integer("max_invoices_per_month").notNull(),
  /** Monthly price in USD — 0 for free tier */
  priceMonthly: numeric("price_monthly", { precision: 10, scale: 2 }).notNull(),
  /** Annual price in USD (optional) */
  priceYearly: numeric("price_yearly", { precision: 10, scale: 2 }),
  /** Stripe Price ID for monthly billing */
  stripePriceIdMonthly: varchar("stripe_price_id_monthly", { length: 255 }),
  /** Stripe Price ID for yearly billing */
  stripePriceIdYearly: varchar("stripe_price_id_yearly", { length: 255 }),
  /** Feature list for display, e.g. ["PDF extraction","Email support"] */
  features: jsonb(),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
