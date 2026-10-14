"use client";

/**
 * Reader for the client-side console ring buffer populated by the inline
 * `<Script id="client-log-capture" strategy="beforeInteractive">` block in
 * `src/app/layout.tsx`. The script runs synchronously before React mounts
 * so we capture pre-hydration / SSR-bridge logs too. Keep the buffer shape
 * (`window.__clientLogStore = { entries, patched }`) in sync with the
 * inline script.
 */

export interface ClientLogEntry {
  timestamp: string;
  level: "log" | "info" | "warn" | "error";
  message: string;
}

interface ClientLogStore {
  entries: ClientLogEntry[];
  patched: boolean;
}

function getStore(): ClientLogStore | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __clientLogStore?: ClientLogStore };
  return w.__clientLogStore ?? null;
}

/**
 * Installs the console ring-buffer capture on the window object if it hasn't
 * been installed yet (e.g. when the inline layout script didn't run).
 */
export function installClientLogCapture(maxEntries = 200): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __clientLogStore?: ClientLogStore };
  if (w.__clientLogStore?.patched) return;

  const store: ClientLogStore = w.__clientLogStore ?? {
    entries: [],
    patched: false,
  };
  w.__clientLogStore = store;

  const levels = ["log", "info", "warn", "error"] as const;
  for (const level of levels) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      store.entries.push({
        timestamp: new Date().toISOString(),
        level,
        message: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
      });
      if (store.entries.length > maxEntries) store.entries.shift();
      orig(...args);
    };
  }
  store.patched = true;
}

/**
 * Returns the recent client log tail. When the inline capture script
 * hasn't run we surface that as a synthetic entry so the email body shows
 * "(capture script not loaded)" instead of an indistinguishable "(none)".
 */
export function getRecentClientLogs(limit = 50): ClientLogEntry[] {
  const store = getStore();
  if (!store) {
    return [
      {
        timestamp: new Date().toISOString(),
        level: "warn",
        message:
          "[client-logs] window.__clientLogStore not present — inline capture script in src/app/layout.tsx did not run before this read",
      },
    ];
  }
  return store.entries.slice(-limit);
}
