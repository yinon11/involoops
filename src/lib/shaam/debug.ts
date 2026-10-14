/**
 * Diagnostic logger for SHAAM (ITA) OAuth + clearance flows.
 *
 * Gate: prints only when `SHAAM_DEBUG=1`. Always-on for outright errors
 * (caller passes `level: "error"`) so production failures are visible
 * without flipping the env flag.
 *
 * NEVER pass raw token / client_secret / code values into `data`. Use
 * the `redact()` helper for known-secret fields and prefer prefixes
 * (`code_prefix: code.slice(0, 6)`) for opaque identifiers.
 */
type Level = "info" | "warn" | "error";

function isEnabled(): boolean {
  return process.env.SHAAM_DEBUG === "1";
}

function fmt(scope: string, message: string): string {
  return `[shaam:${scope}] ${message}`;
}

function emit(
  level: Level,
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (level === "info" && !isEnabled()) return;
  const payload = data && Object.keys(data).length > 0 ? data : undefined;
  if (level === "error") {
    if (payload) console.error(fmt(scope, message), payload);
    else console.error(fmt(scope, message));
    return;
  }
  if (level === "warn") {
    if (payload) console.warn(fmt(scope, message), payload);
    else console.warn(fmt(scope, message));
    return;
  }
  if (payload) console.log(fmt(scope, message), payload);
  else console.log(fmt(scope, message));
}

export function shaamLog(
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  emit("info", scope, message, data);
}

export function shaamWarn(
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  emit("warn", scope, message, data);
}

export function shaamError(
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  emit("error", scope, message, data);
}

/** Replace a sensitive value with a stable "[redacted:N]" marker. */
export function redact(value: string | null | undefined): string {
  if (!value) return "[empty]";
  return `[redacted:${value.length}]`;
}

/** First N chars of a value, suffixed with "…". Safe for opaque ids. */
export function prefix(value: string | null | undefined, n = 6): string {
  if (!value) return "[empty]";
  return value.length <= n ? value : `${value.slice(0, n)}…`;
}

interface ErrorWithExtras {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  errors?: unknown;
}

/**
 * Walk an Error's `.cause` chain (and any AggregateError `.errors`) and
 * return a flat array of `{name, code, message}` records. Undici exposes
 * the most useful diagnostics on `cause.code` (e.g. `UND_ERR_CONNECT_TIMEOUT`,
 * `UND_ERR_SOCKET`, `ERR_TLS_CERT_ALTNAME_INVALID`), so flattening the
 * chain captures the actual root cause instead of just the wrapping
 * "fetch failed".
 */
export function describeError(err: unknown, depth = 0): Array<{
  name?: string;
  code?: string;
  message?: string;
}> {
  if (depth > 6 || err == null || typeof err !== "object") {
    return [{ message: String(err) }];
  }
  const e = err as ErrorWithExtras;
  const entry: { name?: string; code?: string; message?: string } = {};
  if (typeof e.name === "string" && e.name) entry.name = e.name;
  if (typeof e.code === "string" && e.code) entry.code = e.code;
  if (typeof e.message === "string" && e.message) entry.message = e.message;
  const out = [entry];
  if (e.cause != null) {
    out.push(...describeError(e.cause, depth + 1));
  }
  if (Array.isArray(e.errors)) {
    for (const sub of e.errors) {
      out.push(...describeError(sub, depth + 1));
    }
  }
  return out;
}
