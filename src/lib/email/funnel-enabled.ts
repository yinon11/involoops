/**
 * Global kill switch for funnel automation (new entries, scheduled sends, immediate sends).
 * Exits and unsubscribe/account-deleted cleanup still run so DB state stays consistent.
 *
 * Set EMAIL_FUNNELS_ENABLED=false (or 0, no, off) to disable. Omit or "true" to enable.
 */
export function areEmailFunnelsEnabled(): boolean {
  const raw = process.env.EMAIL_FUNNELS_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  if (
    raw === "0" ||
    raw === "false" ||
    raw === "no" ||
    raw === "off" ||
    raw === "disabled"
  ) {
    return false;
  }
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
