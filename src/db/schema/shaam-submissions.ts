import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { businessEntities } from "./business-entities";
import { outboundInvoices } from "./outbound-invoices";
import { shaamEnvironmentEnum } from "./shaam-authorizations";

export const SHAAM_RESPONSE_STATUSES = [
  "APPROVED",
  "REJECTED",
  "HELD",
  "TIMEOUT",
  "NETWORK_ERROR",
  "SKIPPED",
] as const;
export type ShaamResponseStatus = (typeof SHAAM_RESPONSE_STATUSES)[number];

export const shaamResponseStatusEnum = pgEnum(
  "shaam_response_status",
  SHAAM_RESPONSE_STATUSES,
);

/**
 * Append-only log of every SHAAM clearance submission attempt (Spec
 * 08). A single outbound document may produce many rows here — one
 * per retry, one per action code, one per cron-driven reconciliation.
 *
 * Tokens are NEVER stored here. `requestPayload` is the token-free
 * body handed to the ITA; `responsePayload` is the verbatim ITA
 * response JSON.
 */
export const shaamSubmissions = pgTable(
  "shaam_submissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    environment: shaamEnvironmentEnum("environment").notNull(),
    actionCode: integer("action_code").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestPayload: jsonb("request_payload").notNull(),
    requestPayloadHash: text("request_payload_hash").notNull(),
    responsePayload: jsonb("response_payload"),
    responseHttpStatus: integer("response_http_status"),
    responseAllocationNumber: text("response_allocation_number"),
    responseStatus: shaamResponseStatusEnum("response_status"),
    responseErrorCode: text("response_error_code"),
    responseErrorMessage: text("response_error_message"),
    requestId: text("request_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("shaam_submissions_document_submitted_at_idx").on(
      table.documentId,
      table.submittedAt,
    ),
    index("shaam_submissions_entity_submitted_at_idx").on(
      table.businessEntityId,
      table.submittedAt,
    ),
    unique("shaam_submissions_idempotency_unique").on(
      table.idempotencyKey,
      table.environment,
    ),
  ],
);

export const shaamSubmissionsRelations = relations(shaamSubmissions, ({ one }) => ({
  document: one(outboundInvoices, {
    fields: [shaamSubmissions.documentId],
    references: [outboundInvoices.id],
  }),
  businessEntity: one(businessEntities, {
    fields: [shaamSubmissions.businessEntityId],
    references: [businessEntities.id],
  }),
}));
