import type { ToolAnnotations } from "@modelcontextprotocol/server";

/**
 * Read-only tools. `destructiveHint` is omitted: the MCP spec says it only
 * applies when `readOnlyHint` is false, and the default (`true`) must not
 * be advertised on a tool that never writes.
 */
export const readOnlyAnnotations = {
  readOnlyHint: true,
} as const satisfies ToolAnnotations;

/** Writes against our own API. `openWorldHint` stays at the protocol default. */
export function mutatingAnnotations(opts: {
  destructive: boolean;
  idempotent: boolean;
}): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: opts.destructive,
    idempotentHint: opts.idempotent,
  };
}

/**
 * Copy the tool's top-level `title` into `annotations.title`.
 * The Claude Connectors Directory reads the annotation, not the top-level field.
 */
export function withTitle<T extends { title: string; annotations: ToolAnnotations }>(
  config: T,
): T {
  return {
    ...config,
    annotations: { ...config.annotations, title: config.title },
  };
}
