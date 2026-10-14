import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

/**
 * Webhook endpoint registered by a user. The signing secret is stored
 * as HMAC-SHA-256(secret, API_KEY_PEPPER) — same scheme as api_keys.
 * See docs/api/05-webhooks.md.
 */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: varchar({ length: 2048 }).notNull(),
    description: varchar({ length: 500 }),
    /** Array of event types (e.g. "outbound_invoice.issued") or globs. */
    events: text("events").array().notNull(),
    /**
     * Signing secret stored as AES-256-GCM ciphertext. The worker
     * decrypts at send time because HMAC signing requires the plaintext
     * (Stripe/Slack convention). Same scheme as users.anthropic_api_key_*.
     */
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretIv: varchar("secret_iv", { length: 64 }).notNull(),
    secretTag: varchar("secret_tag", { length: 64 }).notNull(),
    /** First 8 chars of the public half, for UI display after creation. */
    secretHint: varchar("secret_hint", { length: 12 }).notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastDeliveryAt: timestamp("last_delivery_at"),
    lastSuccessAt: timestamp("last_success_at"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    /** Set when the worker auto-disables the endpoint after chronic failures. */
    disabledAt: timestamp("disabled_at"),
    disabledReason: varchar("disabled_reason", { length: 255 }),
  },
  (t) => [index("webhook_endpoints_user_idx").on(t.userId)],
);

export const webhookEndpointsRelations = relations(
  webhookEndpoints,
  ({ one }) => ({
    user: one(users, {
      fields: [webhookEndpoints.userId],
      references: [users.id],
    }),
  }),
);

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;

/**
 * One row per delivery attempt tree (not per attempt — the same row is
 * updated on each retry). The `(status, next_attempt_at)` partial index
 * is what the cron worker reads from.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid().primaryKey().defaultRandom(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: varchar("event_id", { length: 64 }).notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: jsonb().notNull(),
    status: varchar({ length: 16 }).notNull().default("pending"),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    lastResponseStatus: integer("last_response_status"),
    lastResponseSnippet: text("last_response_snippet"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
  },
  (t) => [
    index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt),
    index("webhook_deliveries_event_idx").on(t.eventId),
  ],
);

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "dead";
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
