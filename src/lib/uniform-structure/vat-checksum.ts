/**
 * Israeli 9-digit ID / Osek Murshe checksum (מספר ת״ז / ע.מ).
 *
 * Algorithm per the Ministry of Interior:
 *   1. Pad to 9 digits with leading zeros.
 *   2. For each digit, multiply by weights [1, 2, 1, 2, 1, 2, 1, 2, 1].
 *   3. If the product is > 9, sum its digits (i.e. subtract 9).
 *   4. Sum all products.
 *   5. Valid iff sum % 10 === 0.
 */
export function isValidIsraeliVatNumber(raw: string): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return false;
  const padded = trimmed.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const digit = Number(padded[i]);
    const weight = (i % 2) + 1;
    const product = digit * weight;
    sum += product > 9 ? product - 9 : product;
  }
  return sum % 10 === 0;
}
