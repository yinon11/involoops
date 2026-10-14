/**
 * Spec 10 — shared types for the ITA "Uniform Structure File Output
 * Instructions v1.31" (`מבנה אחיד`). Every record type is described
 * by a centralised `FIELDS` array of `FieldSpec` entries; the
 * serializer walks the array and stamps out a fixed-width line.
 *
 * Source of truth: ITA "הוראות להפקת קבצים במבנה אחיד" v1.31
 * (1/5/2009). Field numbers, widths, positions, and mandatoriness
 * flags here mirror that PDF directly. If the simulator flags a
 * regression, fix it in the matching record file's `FIELDS` array.
 */

import { randomInt } from "node:crypto";

export type FieldType =
  | "text"
  | "numeric"
  | "signedNumeric"
  | "date"
  | "amount";

export interface FieldSpec {
  name: string;
  /** v1.31 field number (e.g. 1002). Cosmetic — for cross-referencing the spec. */
  fieldNumber?: number;
  /** 1-indexed position in the record (for readability only; the serializer walks in order). */
  start: number;
  length: number;
  type: FieldType;
  mandatory: boolean;
  justify?: "left" | "right";
  pad?: " " | "0";
  /** Fixed literal value for constant fields like `recordCode`. */
  value?: string;
  /** For `amount` / `signedNumeric` — number of implied decimals. Default 2 (ILS cents). */
  decimals?: number;
  /** Descriptive hint for validator error messages. */
  description?: string;
}

/** Common record-code prefix (always 4 chars, positions 1-4). */
export const RECORD_CODE_LENGTH = 4;

export const UNIFORM_STRUCTURE_SPEC_VERSION = "1.31";

/**
 * v1.31 system constant — appears in A000 field 1005, A100 field
 * 1104, and Z900 field 1154. Exactly 8 chars: `&OF1.31&`.
 */
export const UNIFORM_STRUCTURE_SYSTEM_CONSTANT = "&OF1.31&";

/**
 * v1.31 charset code (A000 field 1029):
 *   1 = ISO-8859-8-i  (Windows / logical Hebrew)
 *   2 = CP-862        (DOS)
 * We always emit ISO-8859-8 — every modern OS we deploy on is
 * Linux/Windows.
 */
export const UNIFORM_STRUCTURE_CHARSET_CODE = "1";

/**
 * The iconv-lite identifier corresponding to charset code "1".
 * iconv-lite has no `iso-8859-8-i` alias but the byte mapping is
 * identical to `iso-8859-8` — the `-i` suffix is a directional
 * (logical-vs-visual) hint that doesn't change byte values.
 */
export const UNIFORM_STRUCTURE_ENCODING = "iso-8859-8";

/** v1.31 language code (A000 field 1028): 0=Hebrew, 1=Arabic, 2=Other. */
export const UNIFORM_STRUCTURE_LANGUAGE_CODE = "0";

/**
 * Generate a fresh 15-digit primary ID (v1.31 §2.4(א)): random,
 * unique per export, shared across A000 (field 1004), A100 (field
 * 1103), and Z900 (field 1153). Spec mandates uniqueness per
 * (business, export run) so the simulator can dedup re-uploads.
 */
export function generatePrimaryId(): string {
  // 15 decimal digits = ~50 bits of entropy. We avoid BigInt (the
  // codebase targets ES2017 — see tsconfig.json) by generating each
  // digit independently via crypto.randomInt(10), which uses
  // rejection sampling internally so there's no modulo bias.
  let out = "";
  for (let i = 0; i < 15; i += 1) out += String(randomInt(10));
  return out;
}

/**
 * Vendor identity in the A000 file header: who wrote the software that
 * produced this export. Fields 1007 / 1008 (name, edition) and 1009 / 1010
 * (software house VAT number, name).
 *
 * These are **required configuration, with no defaults on purpose.** They are
 * a declaration to the Israel Tax Authority about who stands behind the books
 * in the file. A baked-in default would mean that any deployment whose
 * operator has not set them files its tenants' records under someone else's
 * company — naming a software house that never wrote, sold or supports that
 * instance, and attributing another business's bookkeeping to it. That is a
 * false statement to a tax authority, and the operator would have no reason to
 * suspect it. `src/lib/shaam/submit.ts` already refuses to send a clearance
 * request without the same identifier; this is the same rule for the export
 * path.
 *
 * The values must match the operator's own ITA software-registration forms
 * character for character. `SOFTWARE_VERSION` keeps a default because an
 * edition number is not an identity claim.
 */
function requiredVendorIdentity(variable: string, what: string): string {
  const value = process.env[variable]?.trim();
  if (!value) {
    throw new Error(
      `${variable} is not set, so the uniform-structure (מבנה אחיד) export ` +
        `cannot be produced. This is ${what}, written into the A000 file ` +
        `header and read by the Israel Tax Authority as a statement about ` +
        `who wrote the software behind these books. It has no default: it has ` +
        `to be the details on your own ITA software registration, exactly as ` +
        `registered. Set SOFTWARE_NAME, SOFTWARE_HOUSE_VAT_NUMBER and ` +
        `SOFTWARE_HOUSE_NAME in your environment — see .env.example.`,
    );
  }
  return value;
}

export function getSoftwareName(): string {
  return requiredVendorIdentity(
    "SOFTWARE_NAME",
    "the registered name of the software (A000 field 1007)",
  ).slice(0, 20);
}
export function getSoftwareVersion(): string {
  return (process.env.SOFTWARE_VERSION ?? "1").slice(0, 20);
}
export function getSoftwareHouseVatNumber(): string {
  return requiredVendorIdentity(
    "SOFTWARE_HOUSE_VAT_NUMBER",
    "the VAT number of the software house (A000 field 1009)",
  );
}
export function getSoftwareHouseName(): string {
  return requiredVendorIdentity(
    "SOFTWARE_HOUSE_NAME",
    "the name of the software house (A000 field 1010)",
  ).slice(0, 20);
}

/**
 * Software acceptance number (מספר תוכנה במרשם / Uniform Structure
 * field 1006) — assigned by the ITA after Form 513 approval.
 *
 * Width: 8 digits per Uniform Structure v1.31 §3.1 field 1006
 * (`9(8)`). Note: the SHAAM REST API uses a 9-digit
 * `accounting_software_number` — that's the same logical identifier
 * but a different wire format. Keep the two paths separate.
 *
 * Pre-approval default: `99999999`. The simulator rejects an
 * all-zeros value as "field zeroed/invalid"; `99999999` is the
 * common test-placeholder accepted by the offline simulator until
 * the real code is issued. Override via `SOFTWARE_REGISTRATION_CODE`
 * once Form 513 is approved.
 */
export function getSoftwareRegistrationCode(): string {
  const raw = (process.env.SOFTWARE_REGISTRATION_CODE ?? "").trim();
  if (raw.length === 0) return "9".repeat(8);
  return raw.padStart(8, "0").slice(0, 8);
}

/**
 * v1.31 field 1011 — `1` = single-year filing (חד שנתי, the user
 * picks a tax year), `2` = multi-year (רב שנתי, the user picks a
 * date range). InvoLoops always passes a date range, so default
 * is `2`.
 */
export function getSoftwareType(): string {
  const raw = (process.env.SOFTWARE_TYPE ?? "2").trim();
  return raw.length === 1 && /^[12]$/.test(raw) ? raw : "2";
}

/**
 * v1.31 field 1013 — accounting method: `1` = single-entry
 * (חד-צידי), `2` = double-entry (כפול). The spec does NOT define
 * `0`; the offline simulator flags zero as "field invalid/zeroed".
 * InvoLoops is invoicing-only and emits no B100/B110 (general
 * ledger) records, so single-entry (`1`) is the safest declaration.
 * Override with `ACCOUNTING_METHOD=2` if a future version actually
 * ships GL records.
 */
export function getAccountingMethod(): string {
  const raw = (process.env.ACCOUNTING_METHOD ?? "1").trim();
  return raw.length === 1 && /^[12]$/.test(raw) ? raw : "1";
}

/**
 * v1.31 field 1030 — name of the compression program used to
 * package BKMVDATA.TXT. Mandatory. Defaults to "ZIP" (we use
 * JSZip). Override via env if a different archiver ships.
 */
export function getCompressionSoftwareName(): string {
  return (process.env.COMPRESSION_SOFTWARE_NAME ?? "ZIP").slice(0, 20);
}
