import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { customers } from "./customers";
import { businessEntities } from "./business-entities";
import { outboundInvoices } from "./outbound-invoices";

export const REVERSE_CHARGE_CONSENT_STATUSES = [
  "pending",
  "signed",
  "revoked",
] as const;
export type ReverseChargeConsentStatus =
  (typeof REVERSE_CHARGE_CONSENT_STATUSES)[number];

/**
 * The buyer's consent to a reverse charge (היפוך חיוב), and the evidence
 * for it.
 *
 * ITA v2.0 spec §2.2.2: "Upon obtaining the customer's consent (in any way
 * agreed between the parties), the reverse charge action will be executed."
 * The spec leaves the *how* to us. This row is the how, and it is written to
 * be the thing you show an auditor: who signed, what exactly they were
 * shown, what exactly they agreed to, from where, and when.
 *
 * Deliberate choices:
 *
 * - **The token is stored hashed.** Team invites keep the raw token; that is
 *   tolerable for an invitation, not for a signature. A leaked row must not
 *   be enough to sign on the buyer's behalf.
 * - **What they agreed to is frozen.** `document_snapshot` holds the facts
 *   the buyer was shown and `document_snapshot_hash` pins them. If the
 *   invoice changes after signing, the hash no longer matches and the
 *   consent does not cover it — issuing must re-check, not trust `status`.
 * - **The wording is pinned too.** `consent_text_version` +
 *   `consent_text_hash` record the exact text in the exact language the
 *   buyer saw, so the consent wording can change later without rewriting
 *   what earlier buyers agreed to.
 * - **The seller's own acknowledgement is part of the record.** Reverse
 *   charge applies only to transaction types the VAT rules allow, and that
 *   judgement is the seller's. A consent request cannot be created without
 *   it, and when it was given is stored here.
 *
 * `expired` is not a status: it is `pending` past `expires_at`, derived at
 * read time so a clock is never trusted to have flipped a column.
 */
export const reverseChargeConsents = pgTable(
  "reverse_charge_consents",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Cascade is safe: an issued fiscal document cannot be deleted, so this
    // only ever removes consents attached to a draft that was thrown away.
    documentId: uuid("document_id")
      .notNull()
      .references(() => outboundInvoices.id, { onDelete: "cascade" }),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),

    status: text("status", { enum: REVERSE_CHARGE_CONSENT_STATUSES })
      .notNull()
      .default("pending"),

    // --- the request -------------------------------------------------------
    requestedByUserId: uuid("requested_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
    /** SHA-256 hex of the link token. The raw token is never stored. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** When the seller confirmed the transaction qualifies, on their responsibility. */
    sellerAcknowledgedAt: timestamp("seller_acknowledged_at", {
      withTimezone: true,
    }).notNull(),
    sellerAcknowledgementVersion: varchar("seller_acknowledgement_version", {
      length: 32,
    }).notNull(),

    // --- what the buyer was shown -----------------------------------------
    documentSnapshot: jsonb("document_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    documentSnapshotHash: varchar("document_snapshot_hash", {
      length: 64,
    }).notNull(),
    consentTextVersion: varchar("consent_text_version", { length: 32 }).notNull(),

    // --- the signature ----------------------------------------------------
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signerName: varchar("signer_name", { length: 200 }),
    signerRole: varchar("signer_role", { length: 200 }),
    /** Language the consent text was rendered in when it was signed. */
    consentLocale: varchar("consent_locale", { length: 5 }),
    /** SHA-256 of the exact consent text as rendered to the signer. */
    consentTextHash: varchar("consent_text_hash", { length: 64 }),
    /** The exact text signed. Kept because a hash is only proof if the text can be reproduced. */
    consentText: text("consent_text"),
    /** PNG data URL of the drawn signature. Size-capped on write. */
    signaturePng: text("signature_png"),
    signerIp: varchar("signer_ip", { length: 64 }),
    signerUserAgent: text("signer_user_agent"),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Object-lock archive key of the signed consent PDF. */
    archiveKey: text("archive_key"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("reverse_charge_consents_document_idx").on(table.documentId),
    index("reverse_charge_consents_entity_idx").on(table.businessEntityId),
  ],
);

export const reverseChargeConsentsRelations = relations(
  reverseChargeConsents,
  ({ one }) => ({
    document: one(outboundInvoices, {
      fields: [reverseChargeConsents.documentId],
      references: [outboundInvoices.id],
    }),
    businessEntity: one(businessEntities, {
      fields: [reverseChargeConsents.businessEntityId],
      references: [businessEntities.id],
    }),
    customer: one(customers, {
      fields: [reverseChargeConsents.customerId],
      references: [customers.id],
    }),
  }),
);
