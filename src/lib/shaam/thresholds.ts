import { compareMoney } from "@/lib/money";

/**
 * Fixed threshold for requiring a customer tax ID on the invoice form.
 * Distinct from the time-varying SHAAM allocation threshold above.
 * Applies only to ILS invoices.
 */
export const CUSTOMER_TAX_ID_REQUIRED_THRESHOLD = 5000;

/**
 * ITA allocation-number thresholds (Spec 08).
 *
 * Each tier is effective from the ITA-published start date. The list
 * is an immutable, chronologically sorted array; `getThresholdForDate`
 * walks it to find the active tier for an issue date.
 *
 * Reference (as of April 2026):
 *   - 2024-05-05: 25,000 NIS pre-VAT
 *   - 2025-01-01: 20,000 NIS pre-VAT
 *   - 2026-01-01: 10,000 NIS pre-VAT
 *   - 2026-06-01: 5,000 NIS pre-VAT
 *
 * New tiers append without touching existing history. The monetary
 * compare uses `compareMoney` (integer-cent) so float drift can't
 * push a 10,000.00 invoice below threshold.
 */

export interface AllocationThreshold {
  effectiveFrom: Date;
  minPreVatAmount: number;
}

export const THRESHOLDS: readonly AllocationThreshold[] = [
  { effectiveFrom: new Date("2024-05-05T00:00:00Z"), minPreVatAmount: 25000 },
  { effectiveFrom: new Date("2025-01-01T00:00:00Z"), minPreVatAmount: 20000 },
  { effectiveFrom: new Date("2026-01-01T00:00:00Z"), minPreVatAmount: 10000 },
  { effectiveFrom: new Date("2026-06-01T00:00:00Z"), minPreVatAmount: 5000 },
];

/**
 * Allow UAT deploys to force a small threshold (e.g. 100 NIS) so
 * test invoices exercise the above-threshold path. Production is
 * expected to leave this env var unset.
 */
function getOverride(): number | null {
  const raw = process.env.SHAAM_THRESHOLD_OVERRIDE;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function getThresholdForDate(date: Date): number {
  const override = getOverride();
  if (override !== null) return override;

  const ts = date.getTime();
  let active = THRESHOLDS[0]?.minPreVatAmount ?? Infinity;
  for (const tier of THRESHOLDS) {
    if (tier.effectiveFrom.getTime() <= ts) {
      active = tier.minPreVatAmount;
    } else {
      break;
    }
  }
  return active;
}

/**
 * Why no allocation number was requested. Two genuinely different kinds,
 * and conflating them is a defect this type used to hide:
 *
 *   - **No obligation.** `below_threshold`, `pre_threshold_date`,
 *     `zero_vat` — the law does not ask for one. Nothing to fix.
 *   - **We could not ask.** `no_customer_tax_id` — the request needs the
 *     customer's 9-digit licensed-dealer number and we do not have it. That
 *     is a blank field on the invoice, not an exemption, and telling the
 *     seller "not required" states the wrong fact.
 *
 * `foreign_currency` is no longer a reason anything is skipped. The
 * accountant settled it (2026-10, `spec-audit-v2.md` §12.8): the obligation
 * is tested on the ILS value before VAT, at the Bank of Israel
 * representative rate. Every caller converts first (`allocationAmountsIls`)
 * and passes `currency: "ILS"`. The branch below remains only so a caller
 * that forgets cannot send foreign amounts to an API that has no currency
 * field; the reason survives in the type for documents skipped before.
 */
export type AllocationSkipReason =
  | "below_threshold"
  | "foreign_currency"
  | "zero_vat"
  | "no_customer_tax_id"
  | "pre_threshold_date";

/** The reasons that mean "nobody is owed a number", as opposed to "we could not ask". */
export const NO_OBLIGATION_REASONS: readonly AllocationSkipReason[] = [
  "below_threshold",
  "pre_threshold_date",
  "zero_vat",
];

export function requiresAllocation(params: {
  issueDate: Date;
  preVatAmount: string;
  currency: string;
  customerIsOsekMurshe: boolean;
  /**
   * Total VAT on the document. Spec §1.2 lists "the invoice includes a
   * non-zero VAT component" among the disclosure conditions, so a wholly
   * zero-rated or exempt document is not one the obligation covers.
   *
   * Optional so a caller with no figure to hand behaves as before (asks)
   * rather than silently skipping clearance on a missing value — the safer
   * direction of the two.
   */
  vatAmount?: string | null;
}): { required: true } | { required: false; reason: AllocationSkipReason } {
  if (params.currency.toUpperCase() !== "ILS") {
    return { required: false, reason: "foreign_currency" };
  }

  const firstTier = THRESHOLDS[0];
  if (firstTier && params.issueDate.getTime() < firstTier.effectiveFrom.getTime()) {
    return { required: false, reason: "pre_threshold_date" };
  }

  const threshold = getThresholdForDate(params.issueDate);
  const absAmount = params.preVatAmount.startsWith("-")
    ? params.preVatAmount.slice(1)
    : params.preVatAmount;
  if (compareMoney(absAmount, String(threshold)) < 0) {
    return { required: false, reason: "below_threshold" };
  }

  if (!params.customerIsOsekMurshe) {
    return { required: false, reason: "no_customer_tax_id" };
  }

  // Zero VAT — §1.2's non-zero-VAT condition fails, so the obligation does
  // not cover this document. Checked last so the more specific reasons above
  // win, and only when a figure was actually supplied: absent means "do not
  // know", and the safe answer to "do not know" is to ask.
  if (params.vatAmount != null && params.vatAmount !== "") {
    const abs = params.vatAmount.startsWith("-")
      ? params.vatAmount.slice(1)
      : params.vatAmount;
    if (compareMoney(abs, "0") === 0) {
      return { required: false, reason: "zero_vat" };
    }
  }

  return { required: true };
}
