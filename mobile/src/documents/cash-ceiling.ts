/**
 * Same ceilings as `src/lib/documents/cash-ceiling.ts`. Kept here because
 * the phone app does not import the web package. A 9-digit customer
 * number counts as a dealer; the server log still checks the check digit.
 */
const CEILING = { dealer: 6_000, private: 15_000 } as const;

export function cashCeilingExceeded(input: {
  amount: number;
  currency: string;
  customerTaxId: string | null | undefined;
}): boolean {
  if (input.currency.toUpperCase() !== "ILS") return false;
  if (!(input.amount > 0)) return false;
  const digits = (input.customerTaxId ?? "").replace(/\D/g, "");
  const ceiling = digits.length === 9 ? CEILING.dealer : CEILING.private;
  const price = input.amount;
  const permitted = price <= ceiling ? price : Math.min(ceiling, Math.round(price * 0.1 * 100) / 100);
  return price - permitted > 0.009;
}
