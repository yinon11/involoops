import {
  pgTable,
  pgEnum,
  uuid,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { businessEntities } from "./business-entities";

export const BUSINESS_ROLES = [
  "OWNER",
  "ACCOUNTANT",
  "ISSUER",
  "VIEWER",
  "AUDITOR",
] as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const businessRoleEnum = pgEnum("business_role", BUSINESS_ROLES);

/**
 * Role assignment of a user to a business entity. The `permissions` JSON
 * is authoritative at runtime; `role` is a preset shortcut used by the
 * settings UI when creating or resetting a membership.
 */
export const businessEntityMembers = pgTable(
  "business_entity_members",
  {
    id: uuid().primaryKey().defaultRandom(),
    businessEntityId: uuid("business_entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: businessRoleEnum("role").notNull(),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("business_entity_members_entity_user_unique").on(
      t.businessEntityId,
      t.userId,
    ),
  ],
);

export const businessEntityMembersRelations = relations(
  businessEntityMembers,
  ({ one }) => ({
    businessEntity: one(businessEntities, {
      fields: [businessEntityMembers.businessEntityId],
      references: [businessEntities.id],
    }),
    user: one(users, {
      fields: [businessEntityMembers.userId],
      references: [users.id],
    }),
  }),
);
