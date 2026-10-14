/**
 * Fixed-width field helpers for building MOVEIN records.
 * Used by the generator and the local verification harness.
 */

export class MoveinFieldError extends Error {
  readonly fieldName: string;
  constructor(fieldName: string, message: string) {
    super(`[${fieldName}] ${message}`);
    this.fieldName = fieldName;
  }
}

export function formatText(
  value: string | null | undefined,
  length: number,
  justify: "left" | "right" = "left",
  pad: " " | "0" = " ",
): string {
  const raw = (value ?? "").replace(/[\r\n\t]/g, " ");
  const truncated = raw.length > length ? raw.slice(0, length) : raw;
  return justify === "right"
    ? truncated.padStart(length, pad)
    : truncated.padEnd(length, pad);
}

export function formatNumeric(
  value: number | string | null | undefined,
  length: number,
  fieldName = "numeric",
): string {
  if (value === null || value === undefined || value === "") {
    return "".padStart(length, " ");
  }
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    throw new MoveinFieldError(fieldName, `not an integer: ${raw}`);
  }
  if (raw.length > length) {
    throw new MoveinFieldError(fieldName, `value ${raw} exceeds width ${length}`);
  }
  return raw.padStart(length, " ");
}

/** DDMMYY — Hashavshevet journal date format. */
export function formatDdMmYy(date: Date, fieldName = "date"): string {
  const dd = date.getDate();
  const mm = date.getMonth() + 1;
  const yy = date.getFullYear() % 100;
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) {
    throw new MoveinFieldError(fieldName, `invalid calendar date: ${date.toISOString()}`);
  }
  return `${String(dd).padStart(2, "0")}${String(mm).padStart(2, "0")}${String(yy).padStart(2, "0")}`;
}

/**
 * 12-char decimal amount field — 2 implied decimals, right-aligned, space-padded.
 * e.g. 100.50 → "      10050" (interpreted as 100.50 by parsers).
 */
export function formatMoveinAmount(
  amount: number,
  length = 12,
  fieldName = "amount",
): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new MoveinFieldError(fieldName, `invalid amount: ${amount}`);
  }
  const cents = Math.round(amount * 100);
  return formatNumeric(String(cents), length, fieldName);
}
