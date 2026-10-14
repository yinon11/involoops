import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
  check,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Uni-directional account links. If (manager_user_id = A, managed_user_id = B),
 * then A can switch into B's session. B cannot switch into A's unless A is already
 * logged in and triggers the switch; see the `originator` JWT claim for switch-back.
 *
 * `capabilities` is the set of granular permission codes the manager (sub-user)
 * holds while acting as the managed account (owner). Empty array → read-only.
 * NULL semantics are not used; default is an empty array. See
 * `src/lib/team/capabilities.ts` for the canonical code list.
 */
export const accountLinks = pgTable(
  "account_links",
  {
    id: uuid().primaryKey().defaultRandom(),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    managedUserId: uuid("managed_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    capabilities: jsonb().$type<string[]>().notNull().default([]),
    /**
     * When true and the manager (sub-user) has exactly one linked owner,
     * the sign-in flow automatically switches them into the owner's
     * account. Owners can disable per-member from Settings → Team.
     */
    autoActAs: boolean("auto_act_as").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("account_links_manager_managed_idx").on(
      table.managerUserId,
      table.managedUserId,
    ),
    check(
      "account_links_no_self_link",
      sql`${table.managerUserId} <> ${table.managedUserId}`,
    ),
  ],
);

export const accountLinksRelations = relations(accountLinks, ({ one }) => ({
  manager: one(users, {
    fields: [accountLinks.managerUserId],
    references: [users.id],
  }),
}));
