import { canonicalJson } from "./canonical-json";

/**
 * Shallow field-level diff for UPDATED audit events. Compares `before` and
 * `after` by JSON-stringified equality of each key — good enough for the
 * primitive-heavy shapes on `outbound_invoices` and cheap to compute
 * inside a transaction.
 *
 * Keys present in one side but missing in the other are included with
 * `undefined` on the absent side coerced to `null` (audit payloads must
 * be JSON-serialisable).
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set<string>([
    ...Object.keys(before),
    ...Object.keys(after),
  ]);
  for (const key of keys) {
    const from = normalize(before[key]);
    const to = normalize(after[key]);
    if (canonicalJson(from) !== canonicalJson(to)) {
      out[key] = { from, to };
    }
  }
  return out;
}

function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}
