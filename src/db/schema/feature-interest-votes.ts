import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

/**
 * "Show interest" votes for upcoming/teased features. One row per (feature,
 * voter). Logged-in users vote with their `userId`; anonymous landing-page
 * visitors vote with a salted SHA-256 of their IP so the same browser /
 * household can't inflate the count and so we never store a raw IP.
 *
 * Used by `<FeatureTeaser>` to render a live "N people want this" pill and
 * by future admin views to prioritise the rollout queue. Catalogue of valid
 * `feature_slug` values lives in `src/lib/teasers/config.ts`.
 */
export const featureInterestVotes = pgTable(
  "feature_interest_votes",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Slug from `src/lib/teasers/config.ts` (e.g. "invoice-generator"). */
    featureSlug: varchar("feature_slug", { length: 64 }).notNull(),
    /** Set when the voter was authenticated; null for anonymous votes. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /**
     * Dedup key. Always present.
     *   - "user:<uuid>" for authenticated voters.
     *   - "ip:<sha256-hex>" for anonymous voters (salted with AUTH_SECRET).
     * Indexed unique per feature so a single voter can't be counted twice.
     */
    voterKey: varchar("voter_key", { length: 96 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("feature_interest_votes_feature_voter_unique").on(
      t.featureSlug,
      t.voterKey,
    ),
    index("feature_interest_votes_feature_idx").on(t.featureSlug),
    index("feature_interest_votes_user_idx").on(t.userId),
  ],
);

export const featureInterestVotesRelations = relations(
  featureInterestVotes,
  ({ one }) => ({
    user: one(users, {
      fields: [featureInterestVotes.userId],
      references: [users.id],
    }),
  }),
);
