import { z } from "zod";

/**
 * A renamed field that older clients may still send.
 *
 * `at` is where the object lives:
 * - `""` — the tool arguments themselves
 * - `"customer"` — a nested object
 * - `"items[]"` — each element of an array
 * - `"shipments[].lines[]"` — arrays nested inside arrays
 *
 * The published JSON Schema stays the canonical schema. `from` is never
 * advertised. When both names arrive, `to` wins.
 */
export type DeprecatedFieldAlias = {
  at: string;
  from: string;
  to: string;
};

/**
 * Rewrite deprecated field names onto their canonical names.
 * Does not mutate `value`. Logs one line per alias that was actually sent.
 */
export function applyDeprecatedAliases(
  value: unknown,
  tool: string,
  aliases: readonly DeprecatedFieldAlias[],
): unknown {
  if (value === null || typeof value !== "object") return value;
  const copy = structuredClone(value);
  for (const alias of aliases) {
    let mapped = 0;
    let ignored = 0;
    for (const node of nodesAt(copy, alias.at)) {
      if (!isRecord(node)) continue;
      if (!Object.prototype.hasOwnProperty.call(node, alias.from)) continue;
      const canonicalPresent =
        Object.prototype.hasOwnProperty.call(node, alias.to) &&
        node[alias.to] !== undefined;
      if (!canonicalPresent) {
        node[alias.to] = node[alias.from];
        mapped += 1;
      } else {
        ignored += 1;
      }
      delete node[alias.from];
    }
    if (mapped > 0 || ignored > 0) {
      const place = alias.at === "" ? alias.from : `${alias.at}.${alias.from}`;
      console.info(
        `[mcp-alias] ${tool} ${place} mapped=${mapped} ignored=${ignored}`,
      );
    }
  }
  return copy;
}

/**
 * Validate with `schema` after applying `aliases`.
 * `tools/list` still publishes `schema` unchanged, because Zod preprocess
 * emits the inner JSON Schema.
 */
export function withDeprecatedAliases<T extends z.ZodType>(
  schema: T,
  tool: string,
  aliases: readonly DeprecatedFieldAlias[],
) {
  return z.preprocess(
    (value) => applyDeprecatedAliases(value, tool, aliases),
    schema,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nodesAt(root: unknown, at: string): unknown[] {
  if (at === "") return [root];
  let current: unknown[] = [root];
  for (const segment of at.split(".")) {
    if (!segment) return [];
    const isArray = segment.endsWith("[]");
    const key = isArray ? segment.slice(0, -2) : segment;
    if (!key) return [];
    const next: unknown[] = [];
    for (const node of current) {
      if (!isRecord(node)) continue;
      const value = node[key];
      if (isArray) {
        if (Array.isArray(value)) next.push(...value);
      } else {
        next.push(value);
      }
    }
    current = next;
  }
  return current;
}
