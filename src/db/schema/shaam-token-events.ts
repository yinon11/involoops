import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { businessEntities } from "./business-entities";
import { shaamEnvironmentEnum } from "./shaam-authorizations";

export const SHAAM_TOKEN_EVENT_TYPES = [
  "AUTHORIZATION_GRANTED",
  "ACCESS_TOKEN_REFRESHED",
  "REFRESH_TOKEN_ROTATED",
  "REFRESH_FAILED",
  "TOKEN_REVOKED",
  "AUTHORIZATION_EXPIRED",
] as const;
export type ShaamTokenEventType = (typeof SHAAM_TOKEN_EVENT_TYPES)[number];

export const shaamTokenEventTypeEnum = pgEnum(
  "shaam_token_event_type",
  SHAAM_TOKEN_EVENT_TYPES,
);

/**
 * Append-only diagnostic log for SHAAM token lifecycle events. Kept
 * separate from the hash-chained audit log (Spec 02) because (a) it
 * doesn't need tamper-evidence at the ITA-compliance tier and (b) the
 * signal-to-noise ratio of token refreshes would drown out the
 * invoice-level events.
 *
 * Token values are NEVER stored here. Only opaque metadata — HTTP
 * status, ITA error codes, request ids, expiry timestamps.
 */
export const shaamTokenEvents = pgTable(
  "shaam_token_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    environment: shaamEnvironmentEnum("environment").notNull(),
    eventType: shaamTokenEventTypeEnum("event_type").notNull(),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("shaam_token_events_entity_created_at_idx").on(
      table.businessEntityId,
      table.createdAt,
    ),
  ],
);

export const shaamTokenEventsRelations = relations(
  shaamTokenEvents,
  ({ one }) => ({
    businessEntity: one(businessEntities, {
      fields: [shaamTokenEvents.businessEntityId],
      references: [businessEntities.id],
    }),
  }),
);
