/**
 * Spec 08+ — fire-and-forget admin alert when the Pattern C issue path
 * falls through to OUTAGE because SHAAM was unreachable / 5xx / timed out.
 * Goes to ADMIN_EMAIL via SES directly (no DB template, no engagement
 * tracking). The retry cron continues to chase the allocation; this email
 * exists so a human knows to glance at the SHAAM portal if outages cluster.
 *
 * Dedupe: we only send on the FIRST transition into an outage state for a
 * given document (caller passes `firstOutage: true`). Subsequent cron
 * retries that stay OUTAGE_ISSUED don't re-notify.
 */

import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getSesClient, getFromEmail } from "./ses";
import { getAdminEmail, warnNoAdminEmail } from "./transactional";

export interface ShaamOutageNotificationParams {
  invoiceId: string;
  formattedNumber: string;
  total: string;
  currency: string | null;
  customerName: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  actionCode: number;
}

/**
 * Send the outage notification. Returns true on send, false on any
 * failure (no SES client, send rejected, etc.). Never throws — callers
 * fire-and-forget so a notification failure can't block invoice issuance.
 */
export async function notifyAdminOfShaamOutage(
  params: ShaamOutageNotificationParams,
): Promise<boolean> {
  const client = getSesClient();
  if (!client) {
    console.warn("[shaam-outage] SES not configured; skipping admin alert");
    return false;
  }

  const subject = `[SHAAM outage] ${params.formattedNumber} issued in fallback mode`;
  const text = buildBodyText(params);
  const html = buildBodyHtml(params);

  const admin = getAdminEmail();
  if (!admin) {
    warnNoAdminEmail("SHAAM outage alert");
    return false;
  }

  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: getFromEmail(),
        Destination: { ToAddresses: [admin] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: text, Charset: "UTF-8" },
              Html: { Data: html, Charset: "UTF-8" },
            },
          },
        },
        ConfigurationSetName:
          process.env.SES_CONFIGURATION_SET?.trim() || undefined,
      }),
    );
    return true;
  } catch (err) {
    console.error(
      "[shaam-outage] failed to send admin alert:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

function buildBodyText(p: ShaamOutageNotificationParams): string {
  return [
    "SHAAM allocation request fell through to outage fallback.",
    "",
    `Invoice:       ${p.formattedNumber} (${p.invoiceId})`,
    `Total:         ${p.total} ${p.currency ?? ""}`.trim(),
    `Customer:      ${p.customerName ?? "(none)"}`,
    `Action code:   ${p.actionCode}`,
    `Error code:    ${p.errorCode ?? "(none)"}`,
    `Error message: ${p.errorMessage ?? "(none)"}`,
    "",
    "The invoice was issued anyway with shaam_status=OUTAGE_ISSUED.",
    "The retry cron (/api/cron/shaam-retry-pending) will keep trying",
    "to clear the allocation; on success the customer-facing PDF is",
    "re-rendered, re-archived, and (if a delivery was queued) emailed",
    "automatically. No action required unless outages cluster — in",
    "that case check the SHAAM portal status.",
  ].join("\n");
}

function buildBodyHtml(p: ShaamOutageNotificationParams): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#666;">${k}</td><td style="padding:4px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escape(v)}</td></tr>`;
  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#222;">
  <p><strong>SHAAM allocation request fell through to outage fallback.</strong></p>
  <table cellpadding="0" cellspacing="0" border="0">
    ${row("Invoice", `${p.formattedNumber} (${p.invoiceId})`)}
    ${row("Total", `${p.total} ${p.currency ?? ""}`.trim())}
    ${row("Customer", p.customerName ?? "(none)")}
    ${row("Action code", String(p.actionCode))}
    ${row("Error code", p.errorCode ?? "(none)")}
    ${row("Error message", p.errorMessage ?? "(none)")}
  </table>
  <p style="margin-top:16px;color:#444;">
    The invoice was issued anyway with <code>shaam_status=OUTAGE_ISSUED</code>.
    The retry cron (<code>/api/cron/shaam-retry-pending</code>) will keep trying
    to clear the allocation; on success the customer-facing PDF is re-rendered,
    re-archived, and (if a delivery was queued) emailed automatically. No action
    required unless outages cluster &mdash; in that case check the SHAAM portal status.
  </p>
</div>`.trim();
}
