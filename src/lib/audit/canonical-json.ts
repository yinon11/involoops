/**
 * Deterministic canonical-JSON serializer for audit and signature payloads.
 *
 * Rules (RFC-8785-inspired; kept deliberately simple and pure):
 *   - Object keys are emitted in lexicographical (Unicode code-point) order.
 *   - No whitespace between tokens.
 *   - Arrays preserve insertion order.
 *   - Only plain JSON-serialisable values are allowed. `undefined`,
 *     functions, symbols, and `NaN`/`Infinity` are rejected — a compliance
 *     payload that silently drops values would break the hash chain.
 *   - Strings and numbers use `JSON.stringify`'s encoding, which is
 *     stable across Node versions for these primitives.
 *
 * The output is byte-identical across runs, which is what makes it safe
 * to feed into SHA-256 for the audit-log hash chain (spec 02) and the
 * document signature input (spec 04).
 */

export type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

export function canonicalJson(value: unknown): string {
  return encode(value);
}

function encode(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(
          `canonicalJson: non-finite number (${String(value)}) is not serialisable`,
        );
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "undefined":
      throw new Error("canonicalJson: undefined is not serialisable");
    case "function":
    case "symbol":
      throw new Error(
        `canonicalJson: values of type ${typeof value} are not serialisable`,
      );
    case "bigint":
      // bigint has no canonical JSON representation; callers must coerce
      // to number or string explicitly before passing in.
      throw new Error(
        "canonicalJson: bigint is not serialisable — coerce to number or string first",
      );
    case "object":
      break;
    default:
      throw new Error(`canonicalJson: unsupported value type ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return "[" + value.map(encode).join(",") + "]";
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(JSON.stringify(key) + ":" + encode(obj[key]));
  }
  return "{" + parts.join(",") + "}";
}
