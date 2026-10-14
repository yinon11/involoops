/**
 * Rotate the bearer token on the TalkToPC "InvoLoops" external MCP server.
 *
 *   INVOLOOPS_MCP_API_KEY=inv_live_... TTP_API_KEY=sk_... \
 *     npx tsx scripts/update-ttp-involoops-mcp-key.ts
 *
 * Or pass the key as the first CLI argument (avoid shell history if you prefer).
 */
import "dotenv/config";

const BACKEND = (process.env.TTP_BACKEND_URL || "https://backend.talktopc.com").replace(
  /\/+$/,
  "",
);
const TTP_API_KEY = process.env.TTP_API_KEY || "";
const MCP_SERVER_ID =
  process.env.TTP_INVOLOOPS_MCP_SERVER_ID?.trim() ||
  "083b8aad-05af-4bed-a654-86edc7e51a76";
const MCP_URL =
  process.env.INVOLOOPS_MCP_URL?.trim() ||
  (process.env.INVOLOOPS_MCP_API_KEY?.includes("inv_test_")
    ? "https://sandbox.involoops.com/api/mcp"
    : "https://involoops.com/api/mcp");

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${TTP_API_KEY}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (parsed as { error?: string; message?: string }).error ||
      (parsed as { message?: string }).message ||
      `${method} ${path} -> ${res.status}`;
    throw new Error(String(msg));
  }
  return parsed;
}

function definitionOf(server: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "name",
    "description",
    "url",
    "transport",
    "auth_type",
    "auth_token",
    "headers",
    "timeout_ms",
    "name_prefix",
    "default_wait_for_response",
    "pending_message",
    "auto_refresh_hours",
    "approval_policy",
    "tool_overrides",
    "is_enabled",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (server[k] !== undefined) out[k] = server[k];
  }
  return out;
}

async function main() {
  const token =
    process.argv[2]?.trim() ||
    process.env.INVOLOOPS_MCP_API_KEY?.trim() ||
    "";
  if (!TTP_API_KEY.startsWith("sk_")) {
    throw new Error("Set TTP_API_KEY (developer key from /agents/developers).");
  }
  if (!token.startsWith("inv_live_") && !token.startsWith("inv_test_")) {
    throw new Error(
      "Pass INVOLOOPS_MCP_API_KEY or argv[1] — full inv_live_… / inv_test_… token.",
    );
  }

  const body = {
    name: "InvoLoops (sandbox)",
    description: "InvoLoops MCP for the voice agent (sandbox URL for inv_test_ keys).",
    url: MCP_URL,
    transport: "streamable_http",
    auth_type: "bearer",
    auth_token: token,
    name_prefix: "involoops",
    approval_policy: "auto",
    default_wait_for_response: true,
    timeout_ms: 30000,
    is_enabled: true,
  };

  const updated = (await api("PUT", `/api/mcp-servers/${MCP_SERVER_ID}`, body)) as {
    server?: Record<string, unknown>;
  };
  const saved = (updated.server ?? updated) as Record<string, unknown>;

  const test = (await api("POST", "/api/mcp-servers/test", {
    server_id: MCP_SERVER_ID,
  })) as { ok?: boolean; error?: string; tools?: unknown[] };

  const refresh = (await api("POST", `/api/mcp-servers/${MCP_SERVER_ID}/refresh`, {})) as {
    server?: Record<string, unknown>;
    error?: string;
  };
  const after = (refresh.server ?? refresh) as Record<string, unknown>;

  console.log(
    JSON.stringify(
      {
        serverId: MCP_SERVER_ID,
        name: saved.name,
        url: saved.url,
        tools_count: Array.isArray(after.tools_snapshot)
          ? after.tools_snapshot.length
          : undefined,
        last_sync_error: after.last_sync_error ?? null,
        test_ok: test.ok,
        test_error: test.ok ? undefined : test.error,
        test_tool_count: Array.isArray(test.tools) ? test.tools.length : undefined,
      },
      null,
      2,
    ),
  );

  if (!test.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
