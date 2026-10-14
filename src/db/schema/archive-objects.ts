import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { businessEntities } from "./business-entities";
import { outboundInvoices } from "./outbound-invoices";

export const ARCHIVE_OBJECT_KINDS = [
  "CANONICAL_JSON",
  "SIGNATURE",
  "PDF",
  "AUDIT_BUNDLE",
  "PDF_FINAL",
  "UNIFORM_STRUCTURE_INI",
  "UNIFORM_STRUCTURE_BKMVDATA",
  // The buyer's signed reverse-charge consent, archived when the invoice
  // it covers is issued.
  "REVERSE_CHARGE_CONSENT",
] as const;

export type ArchiveObjectKind = (typeof ARCHIVE_OBJECT_KINDS)[number];

export const archiveObjectKindEnum = pgEnum(
  "archive_object_kind",
  ARCHIVE_OBJECT_KINDS,
);

/**
 * Postgres-side index of every object written to the 7-year archive
 * bucket (Spec 05). Does NOT store the bytes — those live in MinIO /
 * S3 under COMPLIANCE-mode Object Lock. The row carries the
 * per-business-entity tamper-evidence chain (`chainSequence` +
 * `chainPreviousHash` + `chainEntryHash`) so cron and admin verify
 * paths can walk the chain without any S3 round trip.
 *
 * Chain inserts are serialised via `pg_advisory_xact_lock` keyed on
 * `archive:{businessEntityId}` exactly like the audit hash chain — a
 * failed insert during issue rolls the whole issuance back and leaves
 * an orphan S3 object that the `find-archive-orphans` script catches.
 */
export const archiveObjects = pgTable(
  "archive_objects",
  {
    id: uuid().primaryKey().defaultRandom(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "restrict" }),
    /**
     * Logical reference to the outbound document. No FK so archive
     * rows outlive physical deletes of the source document (which are
     * blocked anyway by the immutability contract).
     */
    documentId: uuid("document_id").notNull(),
    objectKind: archiveObjectKindEnum("object_kind").notNull(),
    s3Bucket: text("s3_bucket").notNull(),
    s3Key: text("s3_key").notNull(),
    /** MinIO / S3 versioning id — required for retention lookups. */
    s3VersionId: text("s3_version_id").notNull(),
    contentSha256: text("content_sha256").notNull(),
    contentLength: bigint("content_length", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
    storedAt: timestamp("stored_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    storedByUserId: uuid("stored_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Per-business-entity monotonic counter. */
    chainSequence: bigint("chain_sequence", { mode: "number" }).notNull(),
    /** Hex SHA-256 of this row's canonical payload. */
    chainEntryHash: text("chain_entry_hash").notNull(),
    /** Hex SHA-256 of the previous entry. Empty string for seq 1. */
    chainPreviousHash: text("chain_previous_hash"),
  },
  (table) => [
    unique("archive_objects_entity_sequence_unique").on(
      table.businessEntityId,
      table.chainSequence,
    ),
    index("archive_objects_document_kind_idx").on(
      table.documentId,
      table.objectKind,
    ),
    index("archive_objects_bucket_key_idx").on(table.s3Bucket, table.s3Key),
    index("archive_objects_business_entity_stored_at_idx").on(
      table.businessEntityId,
      table.storedAt,
    ),
  ],
);

export const archiveObjectsRelations = relations(archiveObjects, ({ one }) => ({
  businessEntity: one(businessEntities, {
    fields: [archiveObjects.businessEntityId],
    references: [businessEntities.id],
  }),
  document: one(outboundInvoices, {
    fields: [archiveObjects.documentId],
    references: [outboundInvoices.id],
  }),
  storedBy: one(users, {
    fields: [archiveObjects.storedByUserId],
    references: [users.id],
  }),
}));
