import { pgTable, uuid, integer, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Point-in-time count of distinct people whose data InvoLoops holds, kept for
 * the Privacy Protection (Data Security) Regulations after amendment 13.
 *
 * The database is a "מאגר המנוהל בידי יחיד" only while it holds fewer than
 * 10,000 people. Each row records one count so the next review compares
 * against it instead of starting from zero. Admin-only; never shown to tenants.
 */
export const privacyPopulationSnapshots = pgTable("privacy_population_snapshots", {
  id: uuid().primaryKey().defaultRandom(),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  takenByUserId: uuid("taken_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /** Distinct people across every source, deduplicated. */
  totalPeople: integer("total_people").notNull(),
  /** Per-source distinct counts at the time of the snapshot. */
  breakdown: jsonb("breakdown").$type<Record<string, number>>().notNull(),
  note: text("note"),
});
