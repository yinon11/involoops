/**
 * Statutory retention for bookkeeping records.
 *
 * Israeli bookkeeping rules (הוראות ניהול פנקסי חשבונות) require a business to
 * keep its books, and the documents behind them, for seven years from the end
 * of the tax year they belong to. That duty sits on the business and outlives a
 * request to erase the account: a right to erasure does not reach data the
 * controller is legally required to keep. GDPR art. 17(3)(b) carves out the
 * same exception.
 *
 * So an erasure request cannot take the invoices with it. What it can and must
 * take is everything identifying the person behind the account — see
 * `purgeUserNow` in `src/actions/gdpr-actions.ts`, which anonymises the account
 * now and defers destroying the documents until retention expires.
 *
 * The period is a named constant on purpose: it is a legal parameter, not a
 * design choice, and it should be findable and changeable in one place.
 */
export const BOOKKEEPING_RETENTION_YEARS = 7;

/**
 * The first instant at which records attributed to `taxYear` may be destroyed:
 * seven full years after that tax year ends.
 *
 * Tax year 2026 ends 2026-12-31, so its records are free from 2034-01-01.
 */
export function retentionExpiresAfterTaxYear(taxYear: number): Date {
  return new Date(Date.UTC(taxYear + BOOKKEEPING_RETENTION_YEARS + 1, 0, 1));
}

/**
 * True when records for `taxYear` are still inside the retention window at
 * `now` and therefore must not be destroyed.
 */
export function isWithinRetention(taxYear: number, now: Date): boolean {
  return now < retentionExpiresAfterTaxYear(taxYear);
}
