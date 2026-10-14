import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { businessEntities } from "./business-entities";

/**
 * Spec 09 — per-business-entity record of the tenant's self-reported
 * gov.il setup status. Orthogonal to `shaam_authorizations` (which
 * holds the technical OAuth state); this table captures the
 * pre-flight checklist that the tenant themselves must complete on
 * gov.il before they can even reach InvoLoops' OAuth step.
 *
 * Every column is a self-report — we have no way to probe gov.il on
 * the tenant's behalf. `osekMurshePresent` is the one derived value,
 * mirrored from `business_entities.osekMurshe` by the readiness
 * service so a single read surfaces the full checklist state.
 */
export const shaamTenantReadiness = pgTable("shaam_tenant_readiness", {
  id: uuid().primaryKey().defaultRandom(),
  businessEntityId: uuid("business_entity_id")
    .notNull()
    .unique()
    .references(() => businessEntities.id, { onDelete: "cascade" }),
  azorIshiConfirmed: boolean("azor_ishi_confirmed").notNull().default(false),
  taagidRegistered: boolean("taagid_registered").notNull().default(false),
  morsheAlAssigned: boolean("morshe_al_assigned").notNull().default(false),
  osekMurshePresent: boolean("osek_murshe_present").notNull().default(false),
  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
  confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  supportContactEmail: text("support_contact_email"),
  supportContactPhone: text("support_contact_phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const shaamTenantReadinessRelations = relations(
  shaamTenantReadiness,
  ({ one }) => ({
    businessEntity: one(businessEntities, {
      fields: [shaamTenantReadiness.businessEntityId],
      references: [businessEntities.id],
    }),
    confirmedBy: one(users, {
      fields: [shaamTenantReadiness.confirmedByUserId],
      references: [users.id],
    }),
  }),
);
