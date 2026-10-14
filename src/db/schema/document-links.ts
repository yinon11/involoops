import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { businessEntities } from "./business-entities";
import { outboundInvoices } from "./outbound-invoices";

export const DOCUMENT_LINK_TYPES = [
  "CREDIT_REVERSES",
  "CREDIT_PARTIAL",
  "DELIVERY_NOTE_REFERENCES",
  "CORRECTED_BY",
] as const;

export type DocumentLinkType = (typeof DOCUMENT_LINK_TYPES)[number];

export const documentLinkTypeEnum = pgEnum(
  "document_link_type",
  DOCUMENT_LINK_TYPES,
);

/**
 * Generic link between two outbound documents. Spec 06 uses it for
 * credit-note → original-invoice linkage (`CREDIT_REVERSES` for full
 * credits, `CREDIT_PARTIAL` for partial credits). The schema is left
 * deliberately generic so future document relationships (delivery note
 * → tax invoice, tax-invoice-receipt → preceding proforma) slot in
 * without DDL changes.
 */
export const documentLinks = pgTable(
  "document_links",
  {
    id: uuid().primaryKey().defaultRandom(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    /** The "child" document — e.g. the credit note. */
    fromDocumentId: uuid("from_document_id")
      .notNull()
      .references(() => outboundInvoices.id, { onDelete: "restrict" }),
    /** The "parent" document — e.g. the original invoice being credited. */
    toDocumentId: uuid("to_document_id")
      .notNull()
      .references(() => outboundInvoices.id, { onDelete: "restrict" }),
    linkType: documentLinkTypeEnum("link_type").notNull(),
    /** Decimal string (e.g. "1234.56") for partial-credit links; NULL otherwise. */
    amount: numeric("amount", { precision: 14, scale: 2 }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("document_links_from_type_idx").on(
      table.fromDocumentId,
      table.linkType,
    ),
    index("document_links_to_type_idx").on(
      table.toDocumentId,
      table.linkType,
    ),
    unique("document_links_from_to_type_unique").on(
      table.fromDocumentId,
      table.toDocumentId,
      table.linkType,
    ),
  ],
);

export const documentLinksRelations = relations(documentLinks, ({ one }) => ({
  businessEntity: one(businessEntities, {
    fields: [documentLinks.businessEntityId],
    references: [businessEntities.id],
  }),
  fromDocument: one(outboundInvoices, {
    fields: [documentLinks.fromDocumentId],
    references: [outboundInvoices.id],
    relationName: "linksFromDocument",
  }),
  toDocument: one(outboundInvoices, {
    fields: [documentLinks.toDocumentId],
    references: [outboundInvoices.id],
    relationName: "linksToDocument",
  }),
  createdBy: one(users, {
    fields: [documentLinks.createdByUserId],
    references: [users.id],
  }),
}));
