import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  smallint,
  timestamp,
  date,
  boolean,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users } from "./users";

export const ENTITY_TYPES = [
  "OSEK_MURSHE",
  "OSEK_PATUR",
  "CHEVRA_BAAM",
  "AMUTA",
  "SHUTAFUT",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const entityTypeEnum = pgEnum("entity_type", ENTITY_TYPES);

export interface BusinessEntityAddress {
  street?: string;
  city?: string;
  zip?: string;
  country?: string;
}

/**
 * Legal business entity ("עוסק"). Today 1:1 with a user, modelled as a
 * separate table so the eventual multi-user-per-business rollout does
 * not require another migration. Every RBAC check, document sequence,
 * and audit-log entry scopes against `business_entities.id`, not
 * `users.id`.
 */
export const businessEntities = pgTable(
  "business_entities",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    legalName: text("legal_name").notNull(),
    legalNameEn: text("legal_name_en"),
    /**
     * The 9-digit identifier that appears on every invoice. Its label
     * varies by `entityType` (Osek Murshe / ח.פ. / ע.ר. / partnership
     * number) but the slot is the same. Stored normalized: spaces, dashes,
     * and dots removed, left-padded to 9 digits. Empty stays null. A
     * partial unique index allows one issuing entity per number.
     */
    osekMurshe: text("osek_murshe"),
    entityType: entityTypeEnum("entity_type").notNull().default("OSEK_MURSHE"),
    address: jsonb("address").$type<BusinessEntityAddress | null>(),
    phone: text("phone"),
    email: text("email"),
    taxYearStartsMonth: smallint("tax_year_starts_month").notNull().default(1),
    /**
     * Default state of the "include VAT" toggle on the create-invoice
     * form. `true` = the next invoice is created with VAT at the
     * statutory rate (currently 18%); `false` = no VAT (0%). The user
     * can still flip the toggle per invoice; this column only seeds
     * the initial state. Osek Patur tenants typically set this to
     * `false`.
     */
    defaultVatInclusive: boolean("default_vat_inclusive")
      .notNull()
      .default(true),
    /**
     * When true, SHAAM allocation for this entity never calls the
     * production ITA API. An active UAT grant is sent to the test
     * path only; otherwise allocation is mocked locally.
     */
    shaamSandbox: boolean("shaam_sandbox").notNull().default(false),
    /**
     * אישור ניכוי מס במקור the business sends to customers. One current
     * PDF, stored under the owner's prefix. The attach flag is the
     * default for invoice emails; each send can still turn it off.
     */
    withholdingCertificateKey: text("withholding_certificate_key"),
    withholdingCertificateFilename: text("withholding_certificate_filename"),
    withholdingCertificateUploadedAt: timestamp(
      "withholding_certificate_uploaded_at",
    ),
    withholdingCertificateValidUntil: date("withholding_certificate_valid_until"),
    attachWithholdingCertificate: boolean("attach_withholding_certificate")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("business_entities_owner_user_id_unique").on(t.ownerUserId),
    uniqueIndex("business_entities_osek_murshe_unique")
      .on(t.osekMurshe)
      .where(sql`${t.osekMurshe} IS NOT NULL AND ${t.osekMurshe} <> ''`),
  ],
);

export const businessEntitiesRelations = relations(
  businessEntities,
  ({ one }) => ({
    owner: one(users, {
      fields: [businessEntities.ownerUserId],
      references: [users.id],
    }),
  }),
);
