import "server-only";

/**
 * Captures recent server log output into an in-process ring buffer so the
 * "I have a problem with this invoice" report can attach a tail. We hook
 * `process.stdout.write` / `process.stderr.write` rather than wrapping
 * `console.*` because Next.js installs its own console wrappers per
 * request — patching console at boot would only replace the outer wrapper
 * and miss every application call. Patching the streams is one level lower
 * so every log the runtime emits ends up here.
 *
 * Imported eagerly from `src/instrumentation.ts` so the patch is in place
 * before any request handler runs.
 */

export interface ServerLogEntry {
  timestamp: string;
  level: "stdout" | "stderr";
  message: string;
}

const MAX_ENTRIES = 500;

interface LogStore {
  entries: ServerLogEntry[];
  patched: boolean;
}

const globalRef = globalThis as unknown as { __serverLogStore?: LogStore };

function getStore(): LogStore {
  if (!globalRef.__serverLogStore) {
    globalRef.__serverLogStore = { entries: [], patched: false };
  }
  return globalRef.__serverLogStore;
}

function record(level: ServerLogEntry["level"], chunk: unknown): void {
  const store = getStore();
  let text: string;
  if (typeof chunk === "string") {
    text = chunk;
  } else if (chunk && typeof (chunk as { toString?: () => string }).toString === "function") {
    text = (chunk as { toString: () => string }).toString();
  } else {
    text = String(chunk);
  }
  // Strip trailing newline so log lines aren't double-spaced in the email.
  const trimmed = text.replace(/\n+$/, "");
  if (!trimmed) return;
  store.entries.push({
    timestamp: new Date().toISOString(),
    level,
    message: trimmed,
  });
  if (store.entries.length > MAX_ENTRIES) {
    store.entries.splice(0, store.entries.length - MAX_ENTRIES);
  }
}

function patchStream(
  stream: NodeJS.WriteStream,
  level: ServerLogEntry["level"]
): void {
  const original = stream.write.bind(stream);
  // Tag the original so we can detect double-patching and avoid recursion.
  type PatchedWrite = typeof stream.write & { __serverLogPatched?: true };
  if ((stream.write as PatchedWrite).__serverLogPatched) return;
  const wrapped: PatchedWrite = function (
    this: NodeJS.WriteStream,
    chunk: unknown,
    ...rest: unknown[]
  ): boolean {
    try {
      record(level, chunk);
    } catch {
      // Never let log capture break the actual write path.
    }
    return (
      original as (chunk: unknown, ...args: unknown[]) => boolean
    )(chunk, ...rest);
  } as unknown as PatchedWrite;
  wrapped.__serverLogPatched = true;
  stream.write = wrapped as typeof stream.write;
}

function patchStreams(store: LogStore): void {
  if (store.patched) return;
  store.patched = true;
  patchStream(process.stdout, "stdout");
  patchStream(process.stderr, "stderr");
  // Marker so we can verify the patch is live in attached log tails.
  process.stdout.write(
    `[server-logs] capture installed at ${new Date().toISOString()}\n`
  );
}

patchStreams(getStore());

export function getRecentServerLogs(limit = 50): ServerLogEntry[] {
  return getStore().entries.slice(-limit);
}
