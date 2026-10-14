import { ApiError } from "@/lib/api/errors";

/** Serialize a successful tool result as JSON text content. */
export function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/** Map thrown errors (including `ApiError`) into an MCP tool error payload. */
export function errorResult(err: unknown) {
  if (err instanceof ApiError) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: {
                code: err.code,
                title: err.title,
                detail: err.detail ?? err.message,
                errors: err.errors,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const message = err instanceof Error ? err.message : "Internal error";
  console.error("[mcp] tool error", err);
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { error: { code: "internal_error", title: message } },
          null,
          2,
        ),
      },
    ],
  };
}

export async function runTool<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (err) {
    return errorResult(err);
  }
}
