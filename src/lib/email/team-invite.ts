import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getFromEmail, getSesClient } from "./ses";

type SupportedLocale = "en" | "he";

function appOrigin(): string {
  const u =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000";
  return u.replace(/\/$/, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface InviteCopy {
  subject: string;
  heading: string;
  body: (inviter: string, expiresAt: string) => string;
  cta: string;
  footer: string;
}

const COPY: Record<SupportedLocale, InviteCopy> = {
  en: {
    subject: "You've been invited to join an Involoops account",
    heading: "Join the team",
    body: (inviter, expiresAt) =>
      `${escapeHtml(inviter)} has invited you to access their Involoops account. Click the button below to accept the invitation and finish setting up your access.<br/><br/>This link expires on <strong>${escapeHtml(expiresAt)}</strong>.`,
    cta: "Accept invitation",
    footer:
      "If you weren't expecting this invitation, you can safely ignore this email.",
  },
  he: {
    subject: "הוזמנת להצטרף לחשבון Involoops",
    heading: "הצטרפות לצוות",
    body: (inviter, expiresAt) =>
      `${escapeHtml(inviter)} הזמין/ה אותך לגשת לחשבון ה־Involoops שלהם. לחצו על הכפתור כדי לאשר את ההזמנה ולהשלים את ההתחברות.<br/><br/>הקישור פג בתאריך <strong>${escapeHtml(expiresAt)}</strong>.`,
    cta: "אישור ההזמנה",
    footer:
      "אם לא ציפיתם להזמנה הזו, ניתן להתעלם מהמייל.",
  },
};

interface SendInvitationEmailParams {
  to: string;
  token: string;
  inviterName: string;
  inviterEmail: string;
  expiresAt: Date;
  locale?: string | null;
}

type Result = { ok: true } | { ok: false; error: string };

/**
 * Send an invitation email straight through SES, without going through the
 * email_logs / templates pipeline — the recipient may not yet have a user
 * record so attaching to a userId is impossible, and seeding a DB template
 * row for a one-shot transactional invite isn't worth the operational cost.
 */
export async function sendTeamInvitationEmail(
  params: SendInvitationEmailParams,
): Promise<Result> {
  const client = getSesClient();
  if (!client) {
    return { ok: false, error: "Email is not configured (SES credentials)." };
  }

  const locale: SupportedLocale = params.locale === "he" ? "he" : "en";
  const copy = COPY[locale];
  const dir = locale === "he" ? "rtl" : "ltr";

  const link = `${appOrigin()}/invite/${encodeURIComponent(params.token)}`;
  const inviter = params.inviterName?.trim()
    ? `${params.inviterName.trim()} (${params.inviterEmail})`
    : params.inviterEmail;
  const expires = params.expiresAt.toISOString().slice(0, 10);

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:24px 28px;">
                <h1 style="margin:0 0 12px;font-size:20px;">${escapeHtml(copy.heading)}</h1>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#374151;">${copy.body(inviter, expires)}</p>
                <p style="margin:0 0 24px;">
                  <a href="${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;">${escapeHtml(copy.cta)}</a>
                </p>
                <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5;">${escapeHtml(copy.footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${copy.heading}

${copy.body(inviter, expires).replace(/<[^>]+>/g, "")}

${copy.cta}: ${link}

${copy.footer}`;

  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: getFromEmail(),
        Destination: { ToAddresses: [params.to] },
        Content: {
          Simple: {
            Subject: { Data: copy.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: html, Charset: "UTF-8" },
              Text: { Data: text, Charset: "UTF-8" },
            },
          },
        },
      }),
    );
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[team-invite] SES send failed:", msg);
    return { ok: false, error: msg };
  }
}
