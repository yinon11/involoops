/**
 * Israeli tax calculation utilities — 2024 schedule.
 *
 * All thresholds and rates are hard-coded to the 2024 tax year published by
 * the Israel Tax Authority. When new brackets are published, update the
 * constants here only; the components and server action consume these
 * functions unchanged.
 *
 * IMPORTANT: every number returned here is an *estimate* based on the data
 * in the system. It does not account for deductions, exemptions, special
 * provisions, or rulings. Always show the disclaimer banner alongside results.
 */

// ─── Income Tax 2024 ────────────────────────────────────────────────────────

/** 2024 annual income tax brackets (ILS). */
const IL_INCOME_TAX_BRACKETS_2024 = [
  { upTo: 81_480, rate: 0.10 },
  { upTo: 116_760, rate: 0.14 },
  { upTo: 187_440, rate: 0.20 },
  { upTo: 260_520, rate: 0.31 },
  { upTo: 540_000, rate: 0.35 },
  { upTo: Infinity, rate: 0.47 },
] as const;

/** Monetary value of one tax credit point in 2024 (ILS/year). */
export const TAX_CREDIT_POINT_VALUE_2024 = 2_904;

/**
 * Compute gross Israeli income tax for the given annual taxable income,
 * applying 2024 marginal brackets. Returns 0 for negative or zero income.
 */
export function computeGrossIncomeTax2024(annualIncome: number): number {
  if (annualIncome <= 0) return 0;
  let tax = 0;
  let remaining = annualIncome;
  let prevThreshold = 0;
  for (const { upTo, rate } of IL_INCOME_TAX_BRACKETS_2024) {
    const slice = Math.min(remaining, upTo - prevThreshold);
    if (slice <= 0) break;
    tax += slice * rate;
    remaining -= slice;
    prevThreshold = upTo;
    if (remaining <= 0) break;
  }
  return Math.round(tax);
}

/**
 * Net income tax after subtracting the annual value of credit points.
 * Clamped to 0 — credits cannot produce a refund on income tax.
 */
export function computeNetIncomeTax2024(
  annualIncome: number,
  creditPoints: number,
): number {
  const gross = computeGrossIncomeTax2024(annualIncome);
  const credit = Math.round(creditPoints * TAX_CREDIT_POINT_VALUE_2024);
  return Math.max(0, gross - credit);
}

// ─── Bituach Leumi (NII) 2024 — self-employed ───────────────────────────────

/**
 * Annual NII rate thresholds for self-employed individuals in 2024.
 * Below 75,972 ILS/year → 5.97 % (reduced rate).
 * Above               → 17.83 % on the excess.
 */
const BL_REDUCED_THRESHOLD_2024 = 75_972; // = 6,331 × 12
const BL_REDUCED_RATE_2024 = 0.0597;
const BL_FULL_RATE_2024 = 0.1783;

/**
 * Compute annual Bituach Leumi contribution for a self-employed person.
 * Returns 0 for non-positive income. Does not apply the BL maximum ceiling
 * (פסגה) since it varies and is seldom reached by the target user base.
 */
export function computeBituachLeumi2024(annualProfit: number): number {
  if (annualProfit <= 0) return 0;
  const reducedPart = Math.min(annualProfit, BL_REDUCED_THRESHOLD_2024);
  const fullPart = Math.max(0, annualProfit - BL_REDUCED_THRESHOLD_2024);
  return Math.round(reducedPart * BL_REDUCED_RATE_2024 + fullPart * BL_FULL_RATE_2024);
}

// ─── Depreciation helper ─────────────────────────────────────────────────────

/**
 * Straight-line depreciation for a single fixed asset over 3 years
 * (the standard Israeli rate for IT equipment and general office machinery).
 * Returns the annual deduction for the requested tax year.
 * Returns 0 if the asset is fully depreciated (purchased more than 3 years ago).
 */
export function annualDepreciation(
  assetAmount: number,
  purchaseYear: number,
  taxYear: number,
): number {
  const age = taxYear - purchaseYear; // 0 = purchased this year
  if (age < 0 || age >= 3) return 0;
  return Math.round(assetAmount / 3);
}

/**
 * Total annual depreciation across all fixed assets for the given tax year.
 */
export function totalDepreciation(
  assets: { amount: number; purchaseYear: number }[],
  taxYear: number,
): number {
  return assets.reduce(
    (sum, a) => sum + annualDepreciation(a.amount, a.purchaseYear, taxYear),
    0,
  );
}

// ─── Entity helpers ──────────────────────────────────────────────────────────

/** Entity types that are subject to the self-employed BL schedule. */
export const SELF_EMPLOYED_ENTITY_TYPES = [
  "OSEK_MURSHE",
  "OSEK_PATUR",
] as const;

export type SelfEmployedEntityType = (typeof SELF_EMPLOYED_ENTITY_TYPES)[number];

export function isSelfEmployedEntityType(entityType: string | null): boolean {
  return (
    entityType !== null &&
    (SELF_EMPLOYED_ENTITY_TYPES as readonly string[]).includes(entityType)
  );
}

// ─── Full estimate bundle ─────────────────────────────────────────────────────

export interface TaxEstimateBundle {
  estimatedProfit: number;
  grossIncomeTax: number;
  netIncomeTax: number;
  bituachLeumi: number | null;
  annualDepreciationTotal: number;
  annualPayrollCost: number;
}

export function computeTaxEstimateBundle(opts: {
  annualGrossRevenue: number;
  annualTotalExpenses: number;
  monthlyPayrollCost: number;
  fixedAssets: { amount: number; purchaseYear: number }[];
  taxYear: number;
  creditPoints: number;
  isSelfEmployed: boolean;
}): TaxEstimateBundle {
  const annualPayrollCost = opts.monthlyPayrollCost * 12;
  const annualDepreciationTotal = totalDepreciation(opts.fixedAssets, opts.taxYear);
  const estimatedProfit = Math.max(
    0,
    opts.annualGrossRevenue -
      opts.annualTotalExpenses -
      annualPayrollCost -
      annualDepreciationTotal,
  );
  const grossIncomeTax = computeGrossIncomeTax2024(estimatedProfit);
  const netIncomeTax = computeNetIncomeTax2024(estimatedProfit, opts.creditPoints);
  const bituachLeumi = opts.isSelfEmployed
    ? computeBituachLeumi2024(estimatedProfit)
    : null;

  return {
    estimatedProfit,
    grossIncomeTax,
    netIncomeTax,
    bituachLeumi,
    annualDepreciationTotal,
    annualPayrollCost,
  };
}
