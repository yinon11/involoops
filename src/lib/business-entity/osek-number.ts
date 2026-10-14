import { isValidIsraeliVatNumber } from "@/lib/uniform-structure/vat-checksum";

/** Shown when another entity already holds this number. No owner details. */
export const DUPLICATE_OSEK_MESSAGE =
  "This business number is already registered on InvoLoops. Contact support@involoops.com.";

export const INVALID_OSEK_FORMAT_MESSAGE =
  "The tax ID number must be exactly 9 digits.";

export const INVALID_OSEK_CHECKSUM_MESSAGE =
  "This business number is not a valid Israeli tax ID.";

export const OSEK_RATE_LIMIT_MESSAGE =
  "Too many business-number checks. Try again later.";

export const OSEK_ISSUED_DOCUMENTS_MESSAGE =
  "This business number cannot be changed because documents have already been issued.";

export type OsekMursheErrorCode =
  | "invalid_format"
  | "invalid_checksum"
  | "duplicate"
  | "rate_limited"
  | "issued_documents";

export class OsekMursheError extends Error {
  readonly code: OsekMursheErrorCode;
  constructor(code: OsekMursheErrorCode, message: string) {
    super(message);
    this.name = "OsekMursheError";
    this.code = code;
  }
}

/**
 * Strip spaces, dashes, and dots, then left-pad a 1–9 digit number to 9.
 * Empty input is "not set". Anything else must pass the Israeli check digit.
 */
export function normalizeOsekMurshe(
  raw: string | null | undefined,
): string | null {
  const stripped = (raw ?? "").replace(/[\s.\-]/g, "");
  if (stripped === "") return null;
  if (!/^\d{1,9}$/.test(stripped)) {
    throw new OsekMursheError("invalid_format", INVALID_OSEK_FORMAT_MESSAGE);
  }
  const padded = stripped.padStart(9, "0");
  if (!isValidIsraeliVatNumber(padded)) {
    throw new OsekMursheError("invalid_checksum", INVALID_OSEK_CHECKSUM_MESSAGE);
  }
  return padded;
}

/**
 * Compare a stored value to a new one. Invalid legacy text stays as trimmed
 * text so the identity lock still sees it as "already set".
 */
export function canonicalOsekMurshe(
  raw: string | null | undefined,
): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  try {
    return normalizeOsekMurshe(trimmed);
  } catch {
    return trimmed;
  }
}
