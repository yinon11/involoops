import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { businessEntities } from "./business-entities";
import { outboundInvoices } from "./outbound-invoices";
import { signingKeys } from "./signing-keys";

/**
 * One row per issued outbound document. Drafts never have a signature.
 * Once a row exists here, the corresponding `outbound_invoices` row is
 * frozen for all signed fields — see the IMMUTABILITY header at the top
 * of `src/actions/outbound-invoice-actions.ts`.
 *
 * `canonicalJson` is the exact payload the signature was computed over;
 * keeping it alongside the signature lets `verifyDocumentSignature`
 * reproduce the verification without re-querying related tables (which
 * could have drifted). The additional "rebuild and compare hash" step in
 * `verify.ts` catches any tampering of the live invoice rows.
 */
export const documentSignatures = pgTable(
  "document_signatures",
  {
    id: uuid().primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .unique()
      .references(() => outboundInvoices.id, { onDelete: "restrict" }),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "restrict" }),
    /** FK to `signing_keys.key_id` (the stable string id, not the row uuid). */
    keyId: text("key_id")
      .notNull()
      .references(() => signingKeys.keyId, { onDelete: "restrict" }),
    /** Duplicated from `signing_keys.algorithm` at signing time for immutability. */
    algorithm: text("algorithm").notNull(),
    /** Hex SHA-256 of the exact canonical JSON that was signed. */
    canonicalJsonHash: text("canonical_json_hash").notNull(),
    /** Base64-encoded signature bytes. */
    signatureBase64: text("signature_base64").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    signedByUserId: uuid("signed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** The exact canonical form that was signed. Stored for reproducibility. */
    canonicalJson: jsonb("canonical_json").notNull(),
    /** Reserved for future signature-format migrations. */
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("document_signatures_business_entity_id_idx").on(
      table.businessEntityId,
    ),
    index("document_signatures_key_id_idx").on(table.keyId),
  ],
);

export const documentSignaturesRelations = relations(
  documentSignatures,
  ({ one }) => ({
    document: one(outboundInvoices, {
      fields: [documentSignatures.documentId],
      references: [outboundInvoices.id],
    }),
    businessEntity: one(businessEntities, {
      fields: [documentSignatures.businessEntityId],
      references: [businessEntities.id],
    }),
    key: one(signingKeys, {
      fields: [documentSignatures.keyId],
      references: [signingKeys.keyId],
    }),
    signedByUser: one(users, {
      fields: [documentSignatures.signedByUserId],
      references: [users.id],
    }),
  }),
);
