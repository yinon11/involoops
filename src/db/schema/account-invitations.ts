import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

/**
 * Pending sub-user invitations. The owner (a paying account) issues an invite
 * with a granted set of capabilities; the recipient receives a tokenised link
 * that expires (default 7 days). On accept we either link an existing user
 * account or send the recipient through signup first and then link.
 */
export const accountInvitations = pgTable(
  "account_invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Account owner that issued the invite — sub-user will manage this owner. */
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Lower-cased email of the invitee. */
    email: varchar({ length: 255 }).notNull(),
    /** 64-char hex token. Single-use; deleted on accept/revoke. */
    token: varchar({ length: 64 }).notNull().unique(),
    /** Granular capability codes the sub-user receives once they accept. */
    capabilities: jsonb().$type<string[]>().notNull().default([]),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("account_invitations_owner_idx").on(table.ownerUserId),
    index("account_invitations_email_idx").on(table.email),
  ],
);

export const accountInvitationsRelations = relations(
  accountInvitations,
  ({ one }) => ({
    owner: one(users, {
      fields: [accountInvitations.ownerUserId],
      references: [users.id],
    }),
  }),
);
