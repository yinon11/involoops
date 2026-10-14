import {
  pgTable,
  pgEnum,
  uuid,
  integer,
  bigint,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { businessEntities } from "./business-entities";
import { DOCUMENT_TYPES } from "@/lib/documents/types";

/**
 * Postgres enum for document kinds. Single source of truth is the
 * `DOCUMENT_TYPES` tuple in `src/lib/documents/types.ts` — keep them in sync.
 *
 * Reused across future compliance tables (audit log, signatures, SHAAM
 * allocation records) so that all of them speak the same vocabulary.
 */
export const documentTypeEnum = pgEnum("document_type", DOCUMENT_TYPES);

/**
 * Per-(user, documentType, taxYear) running counter backing gapless
 * sequential document numbering. Allocation is performed via an
 * INSERT ... ON CONFLICT DO UPDATE RETURNING inside the same transaction
 * that inserts the consuming document, so a failed document insert rolls
 * back the sequence bump and no number is ever burnt.
 *
 * Tenant scoping: every row is keyed on `user_id`. There is no global
 * cross-tenant sequence and no template-level sequence — compliance is
 * per business entity.
 */
export const documentNumberSequences = pgTable(
  "document_number_sequences",
  {
    id: uuid().primaryKey().defaultRandom(),
    /**
     * Authoritative scope for the counter. Every allocation holds a
     * row-level lock on this (business_entity_id, document_type,
     * tax_year) key via ON CONFLICT DO UPDATE RETURNING.
     */
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    /** Denormalised owner for quick query paths; not part of uniqueness. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentType: documentTypeEnum("document_type").notNull(),
    taxYear: integer("tax_year").notNull(),
    /**
     * Highest sequence number issued so far for this
     * (business_entity_id, document_type, tax_year). `mode: "number"` is
     * safe because the counter cannot exceed `Number.MAX_SAFE_INTEGER`
     * in any realistic tax year.
     */
    currentNumber: bigint("current_number", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("document_number_sequences_business_entity_id_idx").on(
      table.businessEntityId,
    ),
    index("document_number_sequences_user_id_idx").on(table.userId),
    unique("document_number_sequences_entity_type_year_unique").on(
      table.businessEntityId,
      table.documentType,
      table.taxYear,
    ),
  ],
);

export const documentNumberSequencesRelations = relations(
  documentNumberSequences,
  ({ one }) => ({
    businessEntity: one(businessEntities, {
      fields: [documentNumberSequences.businessEntityId],
      references: [businessEntities.id],
    }),
    user: one(users, {
      fields: [documentNumberSequences.userId],
      references: [users.id],
    }),
  }),
);
