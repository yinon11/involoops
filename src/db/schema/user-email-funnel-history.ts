import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { emailFunnels } from "./email-funnels";

export const userEmailFunnelHistory = pgTable(
  "user_email_funnel_history",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    funnelId: uuid("funnel_id")
      .notNull()
      .references(() => emailFunnels.id),
    /** "entered", "exited", "completed", "step_sent", "step_skipped", "jumped", "timeout" */
    action: varchar({ length: 50 }).notNull(),
    fromStep: integer("from_step"),
    toStep: integer("to_step"),
    /** For jump-to tracking */
    targetFunnelId: uuid("target_funnel_id"),
    reason: varchar({ length: 255 }),
    /** Additional JSON metadata */
    details: text(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("uefh_user_funnel_idx").on(table.userId, table.funnelId),
  ],
);

export const userEmailFunnelHistoryRelations = relations(
  userEmailFunnelHistory,
  ({ one }) => ({
    user: one(users, {
      fields: [userEmailFunnelHistory.userId],
      references: [users.id],
    }),
    funnel: one(emailFunnels, {
      fields: [userEmailFunnelHistory.funnelId],
      references: [emailFunnels.id],
    }),
  }),
);
