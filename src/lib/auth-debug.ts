/**
 * Set INVOICE_DEBUG_AUTH=1 (e.g. in docker-compose env) to log JWT/session steps.
 * Errors are always logged with prefix [invoice-auth] so you can grep Docker logs:
 *   docker compose logs -f app 2>&1 | grep invoice-auth
 */
const PREFIX = "[invoice-auth]";

export function authDebug(message: string, extra?: Record<string, unknown>): void {
  if (process.env.INVOICE_DEBUG_AUTH !== "1") return;
  const ts = new Date().toISOString();
  if (extra && Object.keys(extra).length > 0) {
    console.log(`${PREFIX} ${ts} ${message}`, extra);
  } else {
    console.log(`${PREFIX} ${ts} ${message}`);
  }
}

export function authLogError(message: string, error: unknown): void {
  console.error(`${PREFIX}`, message, error);
}
