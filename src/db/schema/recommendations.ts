import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

export const RECOMMENDATION_TYPES = [
  "missing_expense",
  "tax_bracket",
  "weekly_digest",
  "overdue_invoice",
  "milestone_due",
  "vat_refund",
] as const;

export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_PRIORITIES = ["info", "warning", "urgent"] as const;
export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number];

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: RECOMMENDATION_TYPES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    priority: text("priority", { enum: RECOMMENDATION_PRIORITIES })
      .notNull()
      .default("info"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Optional structured metadata for the recommendation (e.g. invoice IDs). */
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("recommendations_user_active_idx").on(
      t.userId,
      t.dismissedAt,
      t.createdAt,
    ),
  ],
);

export const recommendationsRelations = relations(
  recommendations,
  ({ one }) => ({
    user: one(users, {
      fields: [recommendations.userId],
      references: [users.id],
    }),
  }),
);
