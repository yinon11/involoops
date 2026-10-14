import type { Dictionary } from "@/lib/i18n/dictionaries";

type AuditDict = Dictionary["audit"];

/**
 * Label for one audit row.
 *
 * `SHAAM_SUBMITTED` is written both when a request actually goes to the
 * Tax Authority and when the check stops first (`skipped: true` — below
 * the threshold, no VAT, a receipt-like document, and so on). The stored
 * event type stays as it is: the log is append-only. The badge is what
 * has to tell the truth.
 */
export function auditEventDisplayLabel(
  eventType: string,
  payload: Record<string, unknown> | null | undefined,
  audit: AuditDict,
): string {
  if (eventType === "SHAAM_SUBMITTED" && payload?.skipped === true) {
    const reasonKey = typeof payload.reason === "string" ? payload.reason : "";
    const reason = audit.shaamSkipReason[reasonKey as keyof AuditDict["shaamSkipReason"]];
    return reason ? `${audit.shaamSkipped} — ${reason}` : audit.shaamSkipped;
  }
  return audit.event[eventType as keyof AuditDict["event"]] ?? eventType;
}
