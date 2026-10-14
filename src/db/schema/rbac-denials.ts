import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { desc } from "drizzle-orm";

/**
 * Lightweight denial log for RBAC observability. Decoupled from the
 * hash-chained `document_audit_log` on purpose: denials are
 * high-cardinality signal (every failed check appends a row) and must
 * not distort the chain's sequence numbering or block writes when the
 * RBAC layer decides to reject.
 */
export const rbacDenials = pgTable(
  "rbac_denials",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    businessEntityId: uuid("business_entity_id"),
    permission: text("permission").notNull(),
    reason: text("reason").notNull(),
    route: text("route"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("rbac_denials_user_id_created_at_idx").on(
      t.userId,
      desc(t.createdAt),
    ),
  ],
);
