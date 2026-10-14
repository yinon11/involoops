/**
 * Money formatting for signed document payloads and arithmetic.
 *
 * Canonical documents (Spec 04) serialise every amount as a 2-decimal
 * string so the signature input is byte-stable regardless of how the
 * value entered the system (`numeric(14,2)` column, client-side number,
 * server computation). `toFixed` is used directly because rounding
 * rules (ROUND_HALF_EVEN) aren't prescribed by ITA for this level of
 * precision — mirroring Postgres' `numeric(14,2)` default is sufficient.
 *
 * Spec 06 adds `addMoney`, `subtractMoney`, and `compareMoney` so credit-
 * note accounting stays away from JS floats. Everything is evaluated as
 * integer cents and re-formatted to a 2-decimal string.
 */

export function formatMoney(value: number | string): string {
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) {
    throw new Error(`formatMoney: non-finite value ${String(value)}`);
  }
  return num.toFixed(2);
}

/** Convert a money-shaped string like "1234.56" or "-12.00" into an integer cent count. */
function toCents(value: number | string): number {
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) {
    throw new Error(`money: non-finite value ${String(value)}`);
  }
  return Math.round(num * 100);
}

function fromCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  const sign = cents < 0 && whole === 0 ? "-" : "";
  return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

export function addMoney(a: number | string, b: number | string): string {
  return fromCents(toCents(a) + toCents(b));
}

export function subtractMoney(
  a: number | string,
  b: number | string,
): string {
  return fromCents(toCents(a) - toCents(b));
}

/**
 * Returns -1 / 0 / 1 in the `Array#sort` convention comparing the two
 * cent-integer representations.
 */
export function compareMoney(a: number | string, b: number | string): number {
  const diff = toCents(a) - toCents(b);
  return diff === 0 ? 0 : diff < 0 ? -1 : 1;
}

export function negateMoney(a: number | string): string {
  return fromCents(-toCents(a));
}
