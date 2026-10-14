import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { emailTemplates } from "./email-templates";
import { emailFunnels } from "./email-funnels";

export const emailLogs = pgTable(
  "email_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Nullable: admin-recipient transactional emails (e.g. signup notification
    // to ADMIN_EMAIL, anonymous contact form) and other system emails have no
    // recipient user. For per-user emails (funnel, password reset, verify,
    // invoice scan confirm) this is set to the recipient's user id.
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    emailTemplateId: uuid("email_template_id")
      .notNull()
      .references(() => emailTemplates.id),
    emailFunnelId: uuid("email_funnel_id").references(() => emailFunnels.id),
    funnelStep: integer("funnel_step"),
    sesMessageId: varchar("ses_message_id", { length: 255 }),
    /** "pending", "sent", "delivered", "bounced", "complained", "failed" */
    status: varchar({ length: 20 }).default("pending").notNull(),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    openedAt: timestamp("opened_at"),
    clickedAt: timestamp("clicked_at"),
    bouncedAt: timestamp("bounced_at"),
    complainedAt: timestamp("complained_at"),
    openCount: integer("open_count").default(0).notNull(),
    clickCount: integer("click_count").default(0).notNull(),
    bounceType: varchar("bounce_type", { length: 50 }),
    recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
    subjectSnapshot: varchar("subject_snapshot", { length: 500 }),
    /** JSON of resolved template variables */
    variablesSnapshot: text("variables_snapshot"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("email_logs_ses_message_id_idx").on(table.sesMessageId),
    index("email_logs_user_id_idx").on(table.userId),
  ],
);

export const emailLogsRelations = relations(emailLogs, ({ one, many }) => ({
  user: one(users, {
    fields: [emailLogs.userId],
    references: [users.id],
  }),
  template: one(emailTemplates, {
    fields: [emailLogs.emailTemplateId],
    references: [emailTemplates.id],
  }),
  funnel: one(emailFunnels, {
    fields: [emailLogs.emailFunnelId],
    references: [emailFunnels.id],
  }),
  clicks: many(emailClicks),
}));

// ── Click tracking ──────────────────────────────────────────────────

export const emailClicks = pgTable("email_clicks", {
  id: uuid().primaryKey().defaultRandom(),
  emailLogId: uuid("email_log_id")
    .notNull()
    .references(() => emailLogs.id, { onDelete: "cascade" }),
  url: text().notNull(),
  clickedAt: timestamp("clicked_at").defaultNow(),
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 45 }),
});

export const emailClicksRelations = relations(emailClicks, ({ one }) => ({
  emailLog: one(emailLogs, {
    fields: [emailClicks.emailLogId],
    references: [emailLogs.id],
  }),
}));
