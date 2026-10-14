import {
  formatAmount,
  formatDate,
  formatNumeric,
  formatSignedNumeric,
  formatText,
  UniformStructureFieldError,
} from "../formatters";
import type { FieldSpec } from "../types";

/**
 * Generic serializer: walks the record-type FIELDS array, pulls each
 * value from the record object, formats per `FieldSpec.type`, and
 * concatenates into the fixed-width line. Every record file exports
 * its FIELDS array + a `serializeXXXX(record)` wrapper that calls
 * this function — keeps each record file declarative.
 */
export function serializeRecord<T extends object>(
  fields: readonly FieldSpec[],
  record: T,
  expectedLength: number,
): string {
  const bag = record as Record<string, unknown>;
  const parts: string[] = [];
  for (const field of fields) {
    const raw = field.value !== undefined ? field.value : bag[field.name];
    const segment = formatField(field, raw);
    if (segment.length !== field.length) {
      throw new UniformStructureFieldError(
        field.name,
        `formatter returned ${segment.length} chars, expected ${field.length}`,
      );
    }
    parts.push(segment);
  }
  const line = parts.join("");
  if (line.length !== expectedLength) {
    throw new UniformStructureFieldError(
      "<record>",
      `record length ${line.length} != expected ${expectedLength}`,
    );
  }
  return line;
}

function formatField(field: FieldSpec, raw: unknown): string {
  switch (field.type) {
    case "text":
      return formatText(
        typeof raw === "string" ? raw : raw == null ? "" : String(raw),
        field.length,
        field.justify,
        field.pad,
        field.mandatory,
        field.name,
      );
    case "numeric":
      return formatNumeric(
        raw as number | string | null | undefined,
        field.length,
        field.pad,
        field.mandatory,
        field.name,
      );
    case "signedNumeric":
      return formatSignedNumeric(
        raw as number | string | null | undefined,
        field.length,
        field.decimals ?? 2,
        field.mandatory,
        field.name,
      );
    case "date":
      return formatDate(
        raw as Date | string | null | undefined,
        field.length,
        field.mandatory,
        field.name,
      );
    case "amount":
      return formatAmount(
        raw as number | string | null | undefined,
        field.length,
        field.decimals ?? 2,
        field.mandatory,
        field.name,
      );
  }
}
