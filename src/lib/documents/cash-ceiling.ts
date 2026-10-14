import { isAllocatableCustomerTaxId } from "@/lib/shaam/customer-tax-id";

/**
 * First schedule of the Law for the Reduction of the Use of Cash
 * (חוק לצמצום השימוש במזומן), as reduced on 1 August 2022 and still
 * the amounts in force. Item (1) is a transaction with a dealer.
 * Item (2) is a transaction with a private person.
 *
 * Above that amount, cash on the same transaction may be at most 10%
 * of the price, and never more than the schedule amount. The price
 * includes VAT.
 */
export const CASH_CEILING_ILS = {
  dealer: 6_000,
  private: 15_000,
} as const;

export type CashCounterparty = keyof typeof CASH_CEILING_ILS;

/** A valid licensed-dealer number is a dealer. Anyone else is private. */
export function cashCounterparty(
  customerTaxId: string | null | undefined,
): CashCounterparty {
  return isAllocatableCustomerTaxId(customerTaxId) ? "dealer" : "private";
}

export interface CashCeilingAssessment {
  exceeded: boolean;
  counterparty: CashCounterparty;
  /** Schedule amount for this customer, in ILS. */
  ceilingIls: number;
  /** Cash the law still allows on this transaction, in ILS. */
  permittedIls: number;
  cashIls: number;
  transactionIls: number;
}

function toIls(
  amount: number,
  currency: string,
  fxRateToIls: number | null,
): number | null {
  if (!Number.isFinite(amount)) return null;
  const cur = currency.toUpperCase();
  if (cur === "ILS" || cur === "NIS") return Math.round(amount * 100) / 100;
  if (fxRateToIls == null || !(fxRateToIls > 0)) return null;
  return Math.round(amount * fxRateToIls * 100) / 100;
}

/**
 * `null` when there is no cash, or when a foreign-currency amount cannot
 * be turned into shekels. Several cash lines are one transaction.
 */
export function assessCashCeiling(input: {
  payments: { method: string; amount: number }[];
  transactionTotal: number;
  currency: string;
  fxRateToIls: number | null;
  customerTaxId: string | null | undefined;
}): CashCeilingAssessment | null {
  const cash = input.payments
    .filter((p) => p.method === "cash")
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  if (!(cash > 0)) return null;

  const cashIls = toIls(cash, input.currency, input.fxRateToIls);
  const transactionIls = toIls(
    input.transactionTotal,
    input.currency,
    input.fxRateToIls,
  );
  if (cashIls == null || transactionIls == null) return null;

  const counterparty = cashCounterparty(input.customerTaxId);
  const ceilingIls = CASH_CEILING_ILS[counterparty];
  const permittedIls =
    transactionIls <= ceilingIls
      ? transactionIls
      : Math.min(ceilingIls, Math.round(transactionIls * 0.1 * 100) / 100);

  return {
    exceeded: cashIls - permittedIls > 0.009,
    counterparty,
    ceilingIls,
    permittedIls,
    cashIls,
    transactionIls,
  };
}
