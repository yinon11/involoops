import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getSesClient, getFromEmail } from "@/lib/email/ses";
import { getAdminEmail, warnNoAdminEmail } from "@/lib/email/transactional";

interface ImmediateErrorEmailParams {
  key: string;
  message: string;
  stack: string | null;
  context: Record<string, unknown> | null;
  fingerprint: string;
}

/**
 * Fire-and-forget direct SES send for `policy=immediate` errors. Bypasses the
 * DB-template path used by user-facing mail (which would force us to seed a
 * row before the reporter could function). Mirrors `shaam-outage-notify.ts`
 * for the same reason.
 */
export async function sendImmediateErrorEmail(
  params: ImmediateErrorEmailParams,
): Promise<boolean> {
  const client = getSesClient();
  if (!client) {
    console.warn("[error-reporter] SES not configured; skipping owner alert");
    return false;
  }

  const subject = `[error] ${params.key}: ${truncate(params.message, 80)}`;
  const text = buildText(params);
  const html = buildHtml(params);

  const admin = getAdminEmail();
  if (!admin) {
    warnNoAdminEmail("error report email");
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
      "[error-reporter] failed to send immediate alert:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

interface DigestRow {
  key: string;
  fingerprint: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  sampleMessage: string;
  sampleStack: string | null;
  sampleContext: Record<string, unknown> | null;
}

export async function sendDigestErrorEmail(
  rows: DigestRow[],
): Promise<boolean> {
  const client = getSesClient();
  if (!client) {
    console.warn("[error-reporter] SES not configured; skipping digest");
    return false;
  }
  if (rows.length === 0) return true;

  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const subject = `[error digest] ${total} event${total === 1 ? "" : "s"} across ${rows.length} key${rows.length === 1 ? "" : "s"}`;
  const text = buildDigestText(rows);
  const html = buildDigestHtml(rows);

  const admin = getAdminEmail();
  if (!admin) {
    warnNoAdminEmail("error report email");
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
      "[error-reporter] failed to send digest:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function stringifyContext(ctx: Record<string, unknown> | null): string {
  if (!ctx) return "(none)";
  try {
    return JSON.stringify(ctx, null, 2);
  } catch {
    return String(ctx);
  }
}

function buildText(p: ImmediateErrorEmailParams): string {
  return [
    `Error key:   ${p.key}`,
    `Fingerprint: ${p.fingerprint}`,
    `Message:     ${p.message}`,
    "",
    "Context:",
    stringifyContext(p.context),
    "",
    "Stack:",
    p.stack ?? "(no stack)",
  ].join("\n");
}

function buildHtml(p: ImmediateErrorEmailParams): string {
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">${k}</td><td style="padding:4px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(v)}</td></tr>`;
  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#222;">
  <p><strong>Immediate error alert</strong></p>
  <table cellpadding="0" cellspacing="0" border="0">
    ${row("Key", p.key)}
    ${row("Fingerprint", p.fingerprint)}
    ${row("Message", p.message)}
  </table>
  <h4 style="margin:16px 0 4px;">Context</h4>
  <pre style="background:#f5f5f5;padding:8px;border-radius:4px;font-size:12px;white-space:pre-wrap;">${escapeHtml(stringifyContext(p.context))}</pre>
  <h4 style="margin:16px 0 4px;">Stack</h4>
  <pre style="background:#f5f5f5;padding:8px;border-radius:4px;font-size:12px;white-space:pre-wrap;">${escapeHtml(p.stack ?? "(no stack)")}</pre>
</div>`.trim();
}

function buildDigestText(rows: DigestRow[]): string {
  const lines: string[] = ["Error digest (last 24h):", ""];
  for (const r of rows) {
    lines.push(
      `[${r.count}x] ${r.key}`,
      `  first: ${r.firstSeen.toISOString()}  last: ${r.lastSeen.toISOString()}`,
      `  sample: ${truncate(r.sampleMessage, 200)}`,
      "",
    );
  }
  return lines.join("\n");
}

function buildDigestHtml(rows: DigestRow[]): string {
  const tableRows = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:ui-monospace,Menlo,monospace;"><strong>${escapeHtml(r.key)}</strong></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${r.count}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;">${escapeHtml(r.firstSeen.toISOString())}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;">${escapeHtml(r.lastSeen.toISOString())}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:ui-monospace,Menlo,monospace;font-size:12px;">${escapeHtml(truncate(r.sampleMessage, 160))}</td>
      </tr>`,
    )
    .join("");
  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#222;">
  <p><strong>Error digest — last 24 hours</strong></p>
  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
    <thead>
      <tr style="background:#f5f5f5;text-align:left;">
        <th style="padding:6px 10px;">Key</th>
        <th style="padding:6px 10px;text-align:right;">Count</th>
        <th style="padding:6px 10px;">First</th>
        <th style="padding:6px 10px;">Last</th>
        <th style="padding:6px 10px;">Sample</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</div>`.trim();
}
