import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { businessEntities } from "./business-entities";

/**
 * Spec 10 — server-side tracking row for each Uniform Structure
 * export job. The actual files land in MinIO under
 * `uniform-structure/{businessEntityId}/{runId}/{INI|BKMVDATA|zip}`;
 * this row holds status + stats + the S3 keys for signed-URL
 * retrieval.
 *
 * Statuses are stored as text rather than a pgEnum so adding a new
 * state later doesn't require `ALTER TYPE ... ADD VALUE` (Spec 08
 * hit that pitfall with the archive kind).
 */
export const uniformStructureExports = pgTable(
  "uniform_structure_exports",
  {
    id: uuid().primaryKey().defaultRandom(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    /** Human-friendly slug e.g. `ex-2026-04-20-abc123`. */
    runId: text("run_id").notNull().unique(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", {
      enum: ["PENDING", "RUNNING", "DONE", "FAILED"],
    })
      .notNull()
      .default("PENDING"),
    stats: jsonb("stats"),
    s3KeyIni: text("s3_key_ini"),
    s3KeyBkmvdata: text("s3_key_bkmvdata"),
    s3KeyZip: text("s3_key_zip"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("uniform_structure_exports_entity_created_at_idx").on(
      table.businessEntityId,
      table.createdAt,
    ),
    index("uniform_structure_exports_status_idx").on(table.status),
  ],
);

export const uniformStructureExportsRelations = relations(
  uniformStructureExports,
  ({ one }) => ({
    businessEntity: one(businessEntities, {
      fields: [uniformStructureExports.businessEntityId],
      references: [businessEntities.id],
    }),
    requestedBy: one(users, {
      fields: [uniformStructureExports.requestedByUserId],
      references: [users.id],
    }),
  }),
);
