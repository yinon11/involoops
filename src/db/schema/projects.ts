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
import { users } from "./users";
import { customers } from "./customers";
import { projectMilestones } from "./project-milestones";

export const PROJECT_STATUSES = ["active", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projects = pgTable(
  "projects",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Optional link to a customer record. Nullable so the project is
     *  preserved if the customer is later deleted. */
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    /** Contract / deal total. Individual milestone amounts should sum to this. */
    totalAmount: numeric("total_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    currency: text("currency").notNull().default("ILS"),
    /** Lifecycle: active → completed | cancelled. */
    status: text("status", { enum: PROJECT_STATUSES })
      .notNull()
      .default("active"),
    startDate: date("start_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("projects_user_id_idx").on(t.userId),
    index("projects_customer_id_idx").on(t.customerId),
  ],
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  customer: one(customers, {
    fields: [projects.customerId],
    references: [customers.id],
  }),
  milestones: many(projectMilestones),
}));
