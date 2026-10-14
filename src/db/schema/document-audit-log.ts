import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  bigint,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations, desc } from "drizzle-orm";
import { users } from "./users";
import { businessEntities } from "./business-entities";
import { documentTypeEnum } from "./document-number-sequences";

/**
 * Append-only audit log for ITA compliance (Spec 02).
 *
 * This module deliberately exports TWO references to the same Drizzle
 * table:
 *
 *   1. Raw `documentAuditLogTable` (file-local, not exported) — same physical
 *      table. Only `appendAuditEntry` performs inserts; consumers use the
 *      Proxy export below. The raw symbol must not be exported: Drizzle Kit
 *      treats each exported `PgTable` as a separate table and would duplicate
 *      indexes on `push`.
 *
 *   2. `documentAuditLog` — a Proxy-wrapped facade. Safe for read queries
 *      (`db.select().from(documentAuditLog)`), but throws if anyone
 *      attempts `documentAuditLog.update(...)`, `.delete(...)`, or
 *      `.insert(...)` as table methods. Drizzle's query builder doesn't
 *      call those methods on the table object itself — `db.insert(table)`
 *      is the canonical pattern — so this Proxy is a defence-in-depth
 *      signal for developer mistakes rather than a hard gate against
 *      `db.insert(documentAuditLog)`. Real append-only enforcement comes
 *      from (a) centralising writes in `appendAuditEntry`, (b) never
 *      exporting `update`/`delete` wrappers for this table, and (c) the
 *      optional Postgres REVOKE in `drizzle/0023b_audit_log_harden.sql`
 *      when the DB role is non-superuser.
 *
 * The public API surface (imported from `@/db/schema`) exposes only the
 * Proxy export; the raw table is only reachable by importing this module
 * directly. See `docs/ita-compliance/02-immutable-audit-log.md`.
 */

export const auditEventTypeEnum = pgEnum("audit_event_type", [
  "CREATED",
  "UPDATED",
  "STATUS_CHANGED",
  "VOIDED",
  "SIGNED",
  "ARCHIVED",
  "SHAAM_SUBMITTED",
  "SHAAM_ALLOCATION_RECEIVED",
  "SHAAM_REJECTED",
  // Seller resolved an ITA refusal by picking one of the statutory
  // options (issue without allocation / cancel). Distinct from
  // SHAAM_REJECTED, which records the ITA's answer, not ours.
  "SHAAM_REJECTION_RESOLVED",
  "PDF_GENERATED",
  "VIEWED",
  "EXPORTED",
  "CREDIT_NOTE_ISSUED",
  // Reverse charge (היפוך חיוב) consent: the seller asked the buyer to agree,
  // and the buyer signed. Recorded in the hash chain so the consent cannot
  // be quietly edited after the fact — the row in reverse_charge_consents is
  // the evidence, this is the tamper-evident timestamp on it.
  "REVERSE_CHARGE_CONSENT_REQUESTED",
  "REVERSE_CHARGE_CONSENT_SIGNED",
  // The seller switched a draft to reverse charge (VAT → 0) on a signed
  // consent, or switched it back.
  "REVERSE_CHARGE_APPLIED",
  "REVERSE_CHARGE_REMOVED",
  // Cash received above the ceiling in the Law for the Reduction of
  // the Use of Cash. The document is still issued; this is the record
  // of which transactions went out that way.
  "CASH_CEILING_EXCEEDED",
]);

const documentAuditLogTable = pgTable(
  "document_audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    /**
     * Authoritative scope for the hash chain (spec 03). Sequence numbering
     * and `previousHash` linkage are per business entity.
     */
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "restrict" }),
    /** Denormalised owner; not part of the hash canonical input. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /**
     * Logical reference to `outbound_invoices.id`. Intentionally NOT a
     * foreign key — audit entries must outlive physical deletes of the
     * document they describe. Deletes of `outbound_invoices` rows are
     * blocked at the application layer in favour of soft-delete.
     */
    documentId: uuid("document_id").notNull(),
    documentType: documentTypeEnum("document_type").notNull(),
    eventType: auditEventTypeEnum("event_type").notNull(),
    eventPayload: jsonb("event_payload").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    actorIp: text("actor_ip"),
    actorUserAgent: text("actor_user_agent"),
    /** Hex SHA-256 of the previous entry's `entryHash`. Empty string for seq 1. */
    previousHash: text("previous_hash"),
    /** Hex SHA-256 of this entry's canonical payload (see append.ts). */
    entryHash: text("entry_hash").notNull(),
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("document_audit_log_business_entity_created_at_idx").on(
      table.businessEntityId,
      desc(table.createdAt),
    ),
    index("document_audit_log_user_id_created_at_idx").on(
      table.userId,
      desc(table.createdAt),
    ),
    index("document_audit_log_document_id_idx").on(table.documentId),
    unique("document_audit_log_entity_sequence_unique").on(
      table.businessEntityId,
      table.sequenceNumber,
    ),
  ],
);

const FORBIDDEN_METHODS = new Set(["update", "delete", "insert"]);

function forbiddenWrite(): never {
  throw new Error(
    "document_audit_log is append-only and can only be written via " +
      "appendAuditEntry(). Direct writes are not permitted. See " +
      "compliance/02-audit-log.md section 2.",
  );
}

/**
 * Read-safe facade for `document_audit_log`. Prefer this export in all
 * query-building code. Inserts are centralized in `appendAuditEntry` only.
 */
export const documentAuditLog: typeof documentAuditLogTable = new Proxy(
  documentAuditLogTable,
  {
    get(target, prop, receiver) {
      if (typeof prop === "string" && FORBIDDEN_METHODS.has(prop)) {
        forbiddenWrite();
      }
      return Reflect.get(target, prop, receiver);
    },
  },
);

export const documentAuditLogRelations = relations(
  documentAuditLogTable,
  ({ one }) => ({
    businessEntity: one(businessEntities, {
      fields: [documentAuditLogTable.businessEntityId],
      references: [businessEntities.id],
    }),
    user: one(users, {
      fields: [documentAuditLogTable.userId],
      references: [users.id],
      relationName: "auditLogUser",
    }),
    actor: one(users, {
      fields: [documentAuditLogTable.actorUserId],
      references: [users.id],
      relationName: "auditLogActor",
    }),
  }),
);

export type AuditEventType =
  (typeof auditEventTypeEnum.enumValues)[number];
