import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Additional email addresses a user has authorised to forward invoices into
 * their account. Ownership of each address is proven by clicking a tokenised
 * link mailed to it (same single-use / 1-hour-expiry pattern as
 * `email_verification_tokens`).
 *
 * Intake matching (see `resolveUser` in `src/lib/gmail/process-message.ts`)
 * treats a VERIFIED row here as a fallback sender match, ranked BELOW the
 * `To:` alias and below the owner's own `users.email`. That ordering is what
 * lets us skip any signup-time check: if this email later registers its own
 * account, mail from it routes to that account (owner-email match wins) and the
 * subordinate link never causes a mis-route or leak.
 *
 * The partial unique index guarantees a given address is a verified sender on
 * at most one account. Unverified (pending) rows are not constrained, so two
 * users can both have a pending invite out to the same address until one
 * verifies.
 */
export const authorizedSenderEmails = pgTable(
  "authorized_sender_emails",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Account that will receive invoices forwarded from `email`. */
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The authorised sender address, stored lower-cased. */
    email: varchar({ length: 255 }).notNull(),
    /** 64-char hex confirmation token. NULL once verified. */
    token: varchar({ length: 64 }),
    /** Confirmation-link expiry. NULL once verified. */
    expiresAt: timestamp("expires_at"),
    /** Set when the recipient confirms ownership. NULL while pending. */
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("authorized_sender_owner_idx").on(table.ownerUserId),
    // A verified address belongs to exactly one account. Pending rows are
    // exempt so a resend / re-invite race doesn't hard-fail.
    uniqueIndex("authorized_sender_email_verified_uq")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.verifiedAt} is not null`),
  ],
);

export const authorizedSenderEmailsRelations = relations(
  authorizedSenderEmails,
  ({ one }) => ({
    owner: one(users, {
      fields: [authorizedSenderEmails.ownerUserId],
      references: [users.id],
    }),
  }),
);
