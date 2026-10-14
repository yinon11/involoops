import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { projects } from "./projects";
import { outboundInvoices } from "./outbound-invoices";

export const MILESTONE_STATUSES = ["pending", "invoiced", "paid"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    dueDate: date("due_date").notNull(),
    /**
     * pending  → awaiting invoicing
     * invoiced → an outbound invoice has been issued and linked
     * paid     → confirmed paid
     */
    status: text("status", { enum: MILESTONE_STATUSES })
      .notNull()
      .default("pending"),
    /**
     * The outbound invoice that covers this milestone, set via
     * `linkMilestoneToInvoice`. Nullable so the milestone survives
     * if the invoice is later voided/deleted.
     */
    outboundInvoiceId: uuid("outbound_invoice_id").references(
      () => outboundInvoices.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("project_milestones_project_id_idx").on(t.projectId),
    index("project_milestones_outbound_invoice_id_idx").on(t.outboundInvoiceId),
  ],
);

export const projectMilestonesRelations = relations(
  projectMilestones,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectMilestones.projectId],
      references: [projects.id],
    }),
    outboundInvoice: one(outboundInvoices, {
      fields: [projectMilestones.outboundInvoiceId],
      references: [outboundInvoices.id],
    }),
  }),
);
