import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import {
  formatMailboxAddress,
  isValidEmailAddress,
  parseMailboxAddress,
  resolveReplyToAddress,
} from "@/lib/email/address";
import { getFromEmail, getSesClient } from "./ses";

export interface SendInvoiceEmailParams {
  to: string;
  subject: string;
  /** Plain-text body; HTML variant is derived from the same text. */
  bodyText: string;
  attachment: {
    filename: string;
    content: Buffer;
    contentType: string;
  };
  extraAttachments?: {
    filename: string;
    content: Buffer;
    contentType: string;
  }[];
  replyTo?: string;
}

export type SendInvoiceEmailResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

/**
 * Send an outbound invoice by email with its PDF attached.
 *
 * Uses SESv2 `Content.Raw` so we can attach the PDF — the `Simple`
 * content shape the funnel/transactional helpers use has no attachment
 * support. Keep this helper invoice-scoped; non-invoice attachments
 * should get their own wrapper to keep the MIME layout obvious.
 */
export async function sendInvoiceEmail(
  params: SendInvoiceEmailParams,
): Promise<SendInvoiceEmailResult> {
  const client = getSesClient();
  if (!client) {
    return {
      ok: false,
      error:
        "Email is not configured. Set SES_AWS_REGION, SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY.",
    };
  }

  const to = params.to.trim();
  if (!isValidEmailAddress(to)) {
    return { ok: false, error: "Invalid recipient email address." };
  }

  const fromMailbox = parseMailboxAddress(getFromEmail());
  if (!fromMailbox) {
    return {
      ok: false,
      error:
        "SES_FROM_EMAIL is not a valid sender address (use user@domain.com or Name <user@domain.com>).",
    };
  }

  const replyTo = resolveReplyToAddress(params.replyTo);

  const raw = buildRawMimeMessage({
    from: formatMailboxAddress(fromMailbox),
    to,
    replyTo,
    subject: params.subject,
    bodyText: params.bodyText,
    attachment: params.attachment,
    extraAttachments: params.extraAttachments,
  });

  try {
    const result = await client.send(
      new SendEmailCommand({
        FromEmailAddress: fromMailbox.email,
        Destination: { ToAddresses: [to] },
        ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
        Content: { Raw: { Data: raw } },
        ConfigurationSetName:
          process.env.SES_CONFIGURATION_SET?.trim() || undefined,
      }),
    );
    return { ok: true, messageId: result.MessageId ?? null };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: msg };
  }
}

interface MimeAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

interface BuildMimeParams {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  bodyText: string;
  attachment: MimeAttachment;
  extraAttachments?: MimeAttachment[];
}

/**
 * Build an RFC 5322 MIME message with the invoice PDF and any extra
 * attachments (for example the withholding-tax certificate).
 *
 * - Subject / filename with non-ASCII are encoded per RFC 2047
 *   (encoded-word) / RFC 2231 respectively.
 * - Both parts are base64-encoded with 76-char line wrapping so no
 *   single line exceeds SMTP's 998-octet cap.
 */
function buildRawMimeMessage(params: BuildMimeParams): Uint8Array {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const subjectEncoded = encodeMimeHeader(params.subject);

  const htmlBody = textToSimpleHtml(params.bodyText);
  const textB64 = wrapBase64(Buffer.from(params.bodyText, "utf8").toString("base64"));
  const htmlB64 = wrapBase64(Buffer.from(htmlBody, "utf8").toString("base64"));

  const altBoundary = `----=_Alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const files = [params.attachment, ...(params.extraAttachments ?? [])];

  const headers = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    ...(params.replyTo ? [`Reply-To: ${params.replyTo}`] : []),
    `Subject: ${subjectEncoded}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];

  const body = [
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    textB64,
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    htmlB64,
    `--${altBoundary}--`,
    "",
    ...files.flatMap((file) => attachmentPart(boundary, file)),
    `--${boundary}--`,
    "",
  ];

  const message = [...headers, "", ...body].join("\r\n");
  return new TextEncoder().encode(message);
}

function attachmentPart(boundary: string, file: MimeAttachment): string[] {
  return [
    `--${boundary}`,
    `Content-Type: ${file.contentType}; name="${asciiSafe(file.filename)}"`,
    `Content-Disposition: attachment; ${encodeRfc2231Filename(file.filename)}`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(file.content.toString("base64")),
  ];
}

/**
 * Hebrew (U+0590–U+05FF) or Arabic (U+0600–U+06FF) anywhere in the body.
 *
 * The body is user-editable free text, and its language does not have to match
 * either the UI locale or the invoice's own `language` — a Hebrew-locale user
 * may well write an English covering note to a foreign customer. So the
 * direction is derived from the text itself rather than threaded down from the
 * caller, which keeps both cases right without a parameter nobody can set
 * correctly at send time.
 */
function isRtlText(text: string): boolean {
  return /[\u0590-\u05FF\u0600-\u06FF]/.test(text);
}

function textToSimpleHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Without an explicit dir, mail clients lay a Hebrew body out left-to-right,
  // which strands leading/trailing punctuation on the wrong side of each line.
  const rtl = isRtlText(text);
  const dir = rtl ? "rtl" : "ltr";
  const lang = rtl ? "he" : "en";
  return `<html lang="${lang}" dir="${dir}"><body dir="${dir}"><pre style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 14px; white-space: pre-wrap; line-height: 1.5; text-align: start;">${escaped}</pre></body></html>`;
}

function encodeMimeHeader(value: string): string {
  // RFC 2047 encoded-word only when the value has non-ASCII.
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function encodeRfc2231Filename(filename: string): string {
  if (/^[\x20-\x7E]*$/.test(filename)) {
    return `filename="${filename.replace(/"/g, "")}"`;
  }
  const encoded = encodeURIComponent(filename).replace(/'/g, "%27");
  return `filename*=UTF-8''${encoded}`;
}

function asciiSafe(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
}

function wrapBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) {
    lines.push(b64.slice(i, i + 76));
  }
  return lines.join("\r\n");
}
