/**
 * Spec 10 — fixed-width field formatters for the Uniform Structure
 * records. Every formatter returns a string of EXACTLY `length`
 * characters, suitable for concatenation into a record line.
 *
 * Hebrew text is passed through as UTF-8; encoding to ISO-8859-8
 * happens at the file level in `build.ts` via `iconv-lite`. Each
 * Hebrew letter is one byte in ISO-8859-8 and one JS string
 * code unit, so the lengths match.
 */

export class UniformStructureFieldError extends Error {
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
  mandatory = false,
  fieldName = "text",
): string {
  const raw = value ?? "";
  if (mandatory && raw.trim().length === 0) {
    throw new UniformStructureFieldError(
      fieldName,
      "mandatory text field is empty",
    );
  }
  // Strip control chars that would break the fixed-width file.
  const safe = raw.replace(/[\r\n\t]/g, " ");
  const truncated = safe.length > length ? safe.slice(0, length) : safe;
  if (justify === "right") {
    return truncated.padStart(length, pad);
  }
  return truncated.padEnd(length, pad);
}

export function formatNumeric(
  value: number | string | null | undefined,
  length: number,
  pad: "0" | " " = "0",
  mandatory = false,
  fieldName = "numeric",
): string {
  if (value === null || value === undefined || value === "") {
    if (mandatory) {
      throw new UniformStructureFieldError(
        fieldName,
        "mandatory numeric field is empty",
      );
    }
    return "".padStart(length, pad);
  }
  const raw = String(value).trim();
  if (!/^-?\d+$/.test(raw)) {
    throw new UniformStructureFieldError(
      fieldName,
      `not an integer: ${raw}`,
    );
  }
  if (raw.length > length) {
    throw new UniformStructureFieldError(
      fieldName,
      `value ${raw} exceeds width ${length}`,
    );
  }
  return raw.padStart(length, pad);
}

/**
 * Signed numeric: first char is `+` or `-`, remaining `length - 1`
 * chars are zero-padded digits. Per the Uniform Structure spec,
 * amounts in signed fields use 2 implied decimals.
 */
export function formatSignedNumeric(
  value: number | string | null | undefined,
  length: number,
  decimals = 2,
  mandatory = false,
  fieldName = "signedNumeric",
): string {
  if (value === null || value === undefined || value === "") {
    if (mandatory) {
      throw new UniformStructureFieldError(
        fieldName,
        "mandatory signed numeric field is empty",
      );
    }
    return "+".padEnd(length, "0");
  }
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) {
    throw new UniformStructureFieldError(
      fieldName,
      `non-finite: ${String(value)}`,
    );
  }
  const factor = Math.pow(10, decimals);
  const cents = Math.round(num * factor);
  const sign = cents < 0 ? "-" : "+";
  const digits = String(Math.abs(cents));
  const digitWidth = length - 1;
  if (digits.length > digitWidth) {
    throw new UniformStructureFieldError(
      fieldName,
      `|${cents}| exceeds digit width ${digitWidth}`,
    );
  }
  return sign + digits.padStart(digitWidth, "0");
}

/**
 * Date field — always `YYYYMMDD` (8 chars). Pass a `Date` or an
 * ISO-8601 string. Empty + non-mandatory → 8 spaces.
 */
export function formatDate(
  value: Date | string | null | undefined,
  length = 8,
  mandatory = false,
  fieldName = "date",
): string {
  if (length !== 8) {
    throw new UniformStructureFieldError(
      fieldName,
      `date field must be 8 wide (got ${length})`,
    );
  }
  if (value === null || value === undefined || value === "") {
    if (mandatory) {
      throw new UniformStructureFieldError(
        fieldName,
        "mandatory date field is empty",
      );
    }
    // Date fields are spec'd as numeric `9(8)`, so empty + optional
    // → 8 zeros (per §2.3(e): leading zeros for empty numeric).
    return "0".repeat(8);
  }
  const d =
    value instanceof Date
      ? value
      : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) {
    throw new UniformStructureFieldError(
      fieldName,
      `invalid date: ${String(value)}`,
    );
  }
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Amount field — unsigned, implied `decimals`. Stored with no
 * decimal point. E.g. `1234.56` with decimals=2 and length=15 →
 * `000000000123456`.
 */
export function formatAmount(
  value: number | string | null | undefined,
  length: number,
  decimals = 2,
  mandatory = false,
  fieldName = "amount",
): string {
  if (value === null || value === undefined || value === "") {
    if (mandatory) {
      throw new UniformStructureFieldError(
        fieldName,
        "mandatory amount field is empty",
      );
    }
    return "".padStart(length, "0");
  }
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) {
    throw new UniformStructureFieldError(
      fieldName,
      `non-finite: ${String(value)}`,
    );
  }
  if (num < 0) {
    throw new UniformStructureFieldError(
      fieldName,
      `amount field cannot be negative (use signedNumeric instead): ${num}`,
    );
  }
  const factor = Math.pow(10, decimals);
  const cents = Math.round(num * factor);
  const digits = String(cents);
  if (digits.length > length) {
    throw new UniformStructureFieldError(
      fieldName,
      `${cents} exceeds width ${length}`,
    );
  }
  return digits.padStart(length, "0");
}
