import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { emailTemplates } from "./email-templates";

// ── Funnel definitions ──────────────────────────────────────────────

export const emailFunnels = pgTable("email_funnels", {
  id: uuid().primaryKey().defaultRandom(),
  code: varchar({ length: 20 }).unique().notNull(),
  name: varchar({ length: 255 }).notNull(),
  funnelGroup: varchar("funnel_group", { length: 50 }).notNull(),
  description: text(),
  /** Event type that triggers entry; NULL = jump-only */
  entryEvent: varchar("entry_event", { length: 100 }),
  /** Only one active funnel per mutex group per user */
  mutexGroup: varchar("mutex_group", { length: 50 }),
  isReentrant: boolean("is_reentrant").default(false).notNull(),
  timeoutHours: integer("timeout_hours"),
  priority: integer().default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  isTransactional: boolean("is_transactional").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailFunnelsRelations = relations(emailFunnels, ({ many }) => ({
  steps: many(emailFunnelSteps),
  exits: many(emailFunnelExits),
}));

// ── Funnel steps ────────────────────────────────────────────────────

export const emailFunnelSteps = pgTable(
  "email_funnel_steps",
  {
    id: uuid().primaryKey().defaultRandom(),
    funnelId: uuid("funnel_id")
      .notNull()
      .references(() => emailFunnels.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    emailTemplateId: uuid("email_template_id")
      .notNull()
      .references(() => emailTemplates.id),
    /** Hours to wait before sending this step */
    delayHours: integer("delay_hours").default(0).notNull(),
    /** "previous_step" or "funnel_entry" */
    delayFrom: varchar("delay_from", { length: 20 }).default("previous_step").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("email_funnel_steps_funnel_step_idx").on(
      table.funnelId,
      table.stepNumber,
    ),
  ],
);

export const emailFunnelStepsRelations = relations(
  emailFunnelSteps,
  ({ one }) => ({
    funnel: one(emailFunnels, {
      fields: [emailFunnelSteps.funnelId],
      references: [emailFunnels.id],
    }),
    template: one(emailTemplates, {
      fields: [emailFunnelSteps.emailTemplateId],
      references: [emailTemplates.id],
    }),
  }),
);

// ── Funnel exit conditions ──────────────────────────────────────────

export const emailFunnelExits = pgTable("email_funnel_exits", {
  id: uuid().primaryKey().defaultRandom(),
  funnelId: uuid("funnel_id")
    .notNull()
    .references(() => emailFunnels.id, { onDelete: "cascade" }),
  /** Event type that triggers exit from this funnel */
  exitCondition: varchar("exit_condition", { length: 100 }).notNull(),
  /** Jump to another funnel on exit (nullable) */
  targetFunnelCode: varchar("target_funnel_code", { length: 20 }),
  isSuccess: boolean("is_success").default(true).notNull(),
  description: text(),
});

export const emailFunnelExitsRelations = relations(
  emailFunnelExits,
  ({ one }) => ({
    funnel: one(emailFunnels, {
      fields: [emailFunnelExits.funnelId],
      references: [emailFunnels.id],
    }),
  }),
);
