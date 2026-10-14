import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users } from "./users";
import { emailFunnels } from "./email-funnels";

export const userEmailFunnelStates = pgTable(
  "user_email_funnel_states",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    funnelId: uuid("funnel_id")
      .notNull()
      .references(() => emailFunnels.id),
    /** 0 = entered but first step not sent yet */
    currentStep: integer("current_step").default(0).notNull(),
    /** "active", "completed", "exited" */
    status: varchar({ length: 20 }).default("active").notNull(),
    enteredAt: timestamp("entered_at").defaultNow(),
    lastStepAt: timestamp("last_step_at"),
    /** When the next email should be sent — used by the cron */
    nextEmailAt: timestamp("next_email_at"),
    exitReason: varchar("exit_reason", { length: 255 }),
    exitedAt: timestamp("exited_at"),
  },
  (table) => [
    index("uefs_user_status_idx").on(table.userId, table.status),
    index("uefs_status_next_email_idx").on(table.status, table.nextEmailAt),
    /**
     * One active state per (user, funnel). The "Already in this funnel" check
     * in `enterFunnel` is a non-atomic read-then-write — two concurrent
     * `PLAN_LIMIT_REACHED` events from parallel uploads at the cap could both
     * pass the check and insert two rows, which then sent the same funnel
     * email twice (see incident 2026-04-23).
     * Completed/exited rows are excluded so future re-entries (when allowed)
     * are not blocked by historical rows.
     */
    uniqueIndex("uefs_user_funnel_active_unique")
      .on(table.userId, table.funnelId)
      .where(sql`status = 'active'`),
  ],
);

export const userEmailFunnelStatesRelations = relations(
  userEmailFunnelStates,
  ({ one }) => ({
    user: one(users, {
      fields: [userEmailFunnelStates.userId],
      references: [users.id],
    }),
    funnel: one(emailFunnels, {
      fields: [userEmailFunnelStates.funnelId],
      references: [emailFunnels.id],
    }),
  }),
);
