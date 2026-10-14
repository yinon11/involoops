import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { pricingTiers } from "./pricing-tiers";

export const userSubscriptions = pgTable(
  "user_subscriptions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    pricingTierId: uuid("pricing_tier_id")
      .notNull()
      .references(() => pricingTiers.id),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
    /** "active", "canceled", "past_due", "free" */
    status: varchar({ length: 20 }).default("free").notNull(),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    canceledAt: timestamp("canceled_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("user_sub_stripe_customer_idx").on(table.stripeCustomerId),
    index("user_sub_stripe_subscription_idx").on(table.stripeSubscriptionId),
  ],
);

export const userSubscriptionsRelations = relations(
  userSubscriptions,
  ({ one }) => ({
    user: one(users, {
      fields: [userSubscriptions.userId],
      references: [users.id],
    }),
    pricingTier: one(pricingTiers, {
      fields: [userSubscriptions.pricingTierId],
      references: [pricingTiers.id],
    }),
  }),
);
