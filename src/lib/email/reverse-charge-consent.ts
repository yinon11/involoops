import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getFromEmail, getSesClient } from "./ses";
import type { ConsentLocale } from "@/lib/outbound/reverse-charge-consent";

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

interface ConsentCopy {
  subject: (seller: string) => string;
  heading: string;
  body: (seller: string, amount: string, expiresAt: string) => string;
  cta: string;
  footer: string;
}

const COPY: Record<ConsentLocale, ConsentCopy> = {
  en: {
    subject: (seller) => `${seller} asks for your consent to a reverse charge`,
    heading: "Reverse-charge consent",
    body: (seller, amount, expiresAt) =>
      `${escapeHtml(seller)} asks you to agree that the VAT on a transaction of ${escapeHtml(amount)} (before VAT) will be reported and paid by you under the reverse-charge mechanism, and that their invoice will be issued at a zero VAT rate.<br/><br/>Review the details and sign on the page below. This link expires on <strong>${escapeHtml(expiresAt)}</strong>.`,
    cta: "Review and sign",
    footer:
      "If you don't recognise this request, don't sign it — contact the sender directly.",
  },
  he: {
    subject: (seller) => `${seller} מבקש/ת את הסכמתך להיפוך חיוב`,
    heading: "הסכמה להיפוך חיוב",
    body: (seller, amount, expiresAt) =>
      `${escapeHtml(seller)} מבקש/ת את הסכמתך לכך שהמע״מ בעסקה בסך ${escapeHtml(amount)} (לפני מע״מ) ידווח וישולם על ידך במנגנון היפוך חיוב, ושהחשבונית תופק בשיעור מע״מ אפס.<br/><br/>יש לעיין בפרטים ולחתום בעמוד שבקישור. הקישור בתוקף עד <strong>${escapeHtml(expiresAt)}</strong>.`,
    cta: "עיון וחתימה",
    footer: "אם אינך מזהה את הבקשה, אין לחתום עליה — פנה/י ישירות לשולח/ת.",
  },
};

interface SendConsentEmailParams {
  to: string;
  token: string;
  sellerName: string;
  /** Pre-VAT amount with currency, as shown in the consent text. */
  amount: string;
  expiresAt: Date;
  locale: ConsentLocale;
}

type Result = { ok: true } | { ok: false; error: string };

/**
 * Send the buyer the link to the reverse-charge consent page.
 *
 * Straight through SES like the team invite, for the same reason: the
 * recipient is an outside party with no user record to hang an email log
 * row on. The email itself proves nothing — the signature on the page is
 * the evidence — so it carries the link and a one-line summary only.
 */
export async function sendReverseChargeConsentEmail(
  params: SendConsentEmailParams,
): Promise<Result> {
  const client = getSesClient();
  if (!client) {
    return { ok: false, error: "Email is not configured (SES credentials)." };
  }

  const copy = COPY[params.locale];
  const dir = params.locale === "he" ? "rtl" : "ltr";
  const link = `${appOrigin()}/consent/${encodeURIComponent(params.token)}?lang=${params.locale}`;
  const expires = params.expiresAt.toISOString().slice(0, 10);
  const body = copy.body(params.sellerName, params.amount, expires);

  const html = `<!doctype html>
<html lang="${params.locale}" dir="${dir}">
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:24px 28px;">
                <h1 style="margin:0 0 12px;font-size:20px;">${escapeHtml(copy.heading)}</h1>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#374151;">${body}</p>
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

${body.replace(/<br\/>/g, "\n").replace(/<[^>]+>/g, "")}

${copy.cta}: ${link}

${copy.footer}`;

  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: getFromEmail(),
        Destination: { ToAddresses: [params.to] },
        Content: {
          Simple: {
            Subject: { Data: copy.subject(params.sellerName), Charset: "UTF-8" },
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
    console.error("[reverse-charge-consent] SES send failed:", msg);
    return { ok: false, error: msg };
  }
}
