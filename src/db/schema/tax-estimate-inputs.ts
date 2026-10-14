import {
  pgTable,
  uuid,
  integer,
  numeric,
  boolean,
  jsonb,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

export interface FixedAsset {
  description: string;
  /** Original purchase cost (full amount). */
  amount: number;
  /** Year the asset was purchased; used to compute remaining depreciation. */
  purchaseYear: number;
}

/**
 * User-supplied adjustments for the annual tax estimate.
 * One row per (user, year); upserted on every save.
 *
 * Note: tax rates and credit-point values are hard-coded to the 2024
 * Israeli schedule in `tax-calculations.ts`. When Israel publishes updated
 * brackets or NII rates, only that file needs to change — this table stays.
 */
export const taxEstimateInputs = pgTable(
  "tax_estimate_inputs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    /**
     * Tax credit points (נקודות זיכוי). Default 2.25 for a single person.
     * Each point is worth 2,904 ILS in 2024. A married person with two
     * children typically has 4.5+ points.
     */
    taxCreditPoints: numeric("tax_credit_points", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("2.25"),
    /**
     * Monthly employer cost (total, including social contributions).
     * Fully deductible against profit.
     */
    monthlyPayrollCost: numeric("monthly_payroll_cost", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    /**
     * When true the UI displays a warning that stock purchases may not be
     * fully deductible as period expenses. The system never auto-adjusts
     * the expense total — only the warning is shown.
     */
    hasInventory: boolean("has_inventory").notNull().default(false),
    /**
     * Fixed assets eligible for depreciation (IT equipment, machinery, etc.).
     * Each asset is depreciated straight-line over 3 years (the standard
     * Israeli rate for IT equipment). Stored as a JSON array so no child
     * table is needed for what is typically 1-5 items.
     */
    fixedAssets: jsonb("fixed_assets")
      .$type<FixedAsset[]>()
      .notNull()
      .default([]),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("tax_estimate_inputs_user_year_unique").on(t.userId, t.year),
    index("tax_estimate_inputs_user_id_idx").on(t.userId),
  ],
);

export const taxEstimateInputsRelations = relations(
  taxEstimateInputs,
  ({ one }) => ({
    user: one(users, {
      fields: [taxEstimateInputs.userId],
      references: [users.id],
    }),
  }),
);
