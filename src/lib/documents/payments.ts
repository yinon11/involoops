import type { DocumentType } from "./types";

/**
 * Payment methods accepted by an Israeli receipt / tax-invoice-receipt.
 * `withholding_tax` is ניכוי מס במקור: the customer remitted that
 * portion to the Tax Authority, so it closes the receipt together
 * with the amount actually received. `other` is the escape hatch for
 * anything else (standing order, crypto, netting). ITA Uniform
 * Structure field 1306 has no withholding code — mapped to 9 (other)
 * in `src/lib/uniform-structure/build.ts`.
 */
export const PAYMENT_METHODS = [
  "cash",
  "check",
  "card",
  "bank_transfer",
  "withholding_tax",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentEntry {
  method: PaymentMethod;
  amount: number;
  currency: string;
  date: string;
  /**
   * Free-text identifier that ties the payment to its real-world
   * trail: check number + bank, last-4 of card, bank reference,
   * etc. Required for every method except `cash` and `withholding_tax`.
   */
  reference?: string;
}

/**
 * True when the given document type must include payment details on
 * the face of the invoice. Receipts and tax-invoice-receipts always
 * do; plain tax invoices never do (payment happens later).
 */
export function requiresPayments(documentType: DocumentType): boolean {
  return documentType === "TAX_INVOICE_RECEIPT" || documentType === "RECEIPT";
}

/**
 * True when the given document type forbids payment details. Credit
 * notes, plain tax invoices, proformas, and delivery notes never
 * include them.
 */
export function allowsPayments(documentType: DocumentType): boolean {
  return requiresPayments(documentType);
}

export type PaymentValidationError =
  | { code: "MISSING"; message: string }
  | { code: "NOT_ALLOWED"; message: string }
  | { code: "INVALID_METHOD"; index: number; message: string }
  | { code: "NON_POSITIVE"; index: number; message: string }
  | { code: "MISSING_REFERENCE"; index: number; message: string }
  | { code: "SUM_MISMATCH"; expected: string; actual: string; message: string };

/**
 * Cents-accurate validation: the sum of payment amounts must exactly
 * equal the document total when payments are required. Currency
 * mismatch across entries is rejected up front — a single invoice is
 * always in one currency per the spec. Floats are multiplied by 100
 * and rounded to avoid 1e-15 drift.
 */
export function validatePayments(
  payments: PaymentEntry[],
  documentType: DocumentType,
  total: number,
  currency: string,
): PaymentValidationError | null {
  if (!allowsPayments(documentType)) {
    if (payments.length > 0) {
      return {
        code: "NOT_ALLOWED",
        message: `Document type ${documentType} cannot carry payment entries.`,
      };
    }
    return null;
  }

  if (payments.length === 0) {
    return {
      code: "MISSING",
      message:
        "At least one payment entry is required for a receipt or tax invoice-receipt.",
    };
  }

  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    if (!PAYMENT_METHODS.includes(p.method)) {
      return {
        code: "INVALID_METHOD",
        index: i,
        message: `Unknown payment method: ${p.method}`,
      };
    }
    if (!(p.amount > 0)) {
      return {
        code: "NON_POSITIVE",
        index: i,
        message: "Payment amount must be greater than zero.",
      };
    }
    const ref = (p.reference ?? "").trim();
    if (p.method !== "cash" && p.method !== "withholding_tax" && !ref) {
      return {
        code: "MISSING_REFERENCE",
        index: i,
        message:
          "Reference is required for non-cash payments (check number, last 4 digits of card, bank transfer id, etc.).",
      };
    }
  }

  const currenciesMatch = payments.every(
    (p) => p.currency.toUpperCase() === currency.toUpperCase(),
  );
  if (!currenciesMatch) {
    return {
      code: "SUM_MISMATCH",
      expected: currency,
      actual: payments.map((p) => p.currency).join(", "),
      message: "All payments must be in the invoice currency.",
    };
  }

  const expectedCents = Math.round(total * 100);
  const actualCents = payments.reduce(
    (acc, p) => acc + Math.round(p.amount * 100),
    0,
  );
  if (expectedCents !== actualCents) {
    return {
      code: "SUM_MISMATCH",
      expected: (expectedCents / 100).toFixed(2),
      actual: (actualCents / 100).toFixed(2),
      message: `Payments total ${(actualCents / 100).toFixed(2)} ${currency} does not match invoice total ${(expectedCents / 100).toFixed(2)} ${currency}.`,
    };
  }

  return null;
}

export class InvoicePaymentValidationError extends Error {
  readonly detail: PaymentValidationError;
  constructor(detail: PaymentValidationError) {
    super(detail.message);
    this.detail = detail;
  }
}

/**
 * Sum of the `withholding_tax` entries — the ניכוי מס במקור the
 * customer remitted to the Tax Authority instead of paying us.
 *
 * The printed receipt intentionally carries the gross: its total is
 * the invoice total, and the withholding is one of the payment lines
 * that closes it (see `validatePayments`). Downstream ledgers need the
 * opposite split — what actually landed in the bank vs. what went to
 * the ITA — so they derive it from here rather than storing a
 * denormalised column.
 *
 * Cents-accurate: amounts are summed in integer agorot to avoid float
 * drift, then converted back.
 */
export function withholdingAmountOf(
  payments: readonly PaymentEntry[] | null | undefined,
): number {
  if (!payments?.length) return 0;
  const cents = payments.reduce(
    (acc, p) =>
      p.method === "withholding_tax"
        ? acc + Math.round((Number(p.amount) || 0) * 100)
        : acc,
    0,
  );
  return cents / 100;
}

/**
 * The payment entries that represent money actually received —
 * everything except `withholding_tax`. Use together with
 * `withholdingAmountOf` when a ledger has to book the cash side and
 * the withholding side to different accounts.
 */
export function receivedPaymentsOf(
  payments: readonly PaymentEntry[] | null | undefined,
): PaymentEntry[] {
  if (!payments?.length) return [];
  return payments.filter((p) => p.method !== "withholding_tax");
}
