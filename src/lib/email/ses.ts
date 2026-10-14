import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import { parseMailboxAddress, resolveReplyToAddress } from "@/lib/email/address";
import { db } from "@/db";
import { emailLogs } from "@/db/schema/email-logs";
import { eq } from "drizzle-orm";

export interface RenderedEmail {
  subject: string;
  html: string;
  text?: string;
}

let _sesClient: SESv2Client | null = null;

export function getSesClient(): SESv2Client | null {
  if (_sesClient) return _sesClient;
  const region = process.env.SES_AWS_REGION;
  const accessKeyId = process.env.SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) return null;
  _sesClient = new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _sesClient;
}

export function getFromEmail(): string {
  return process.env.SES_FROM_EMAIL?.trim() || "noreply@example.com";
}

/** Bare address for SES `FromEmailAddress` (API rejects `Name <email>`). */
export function getSesFromEmailAddress(): string | null {
  return parseMailboxAddress(getFromEmail())?.email ?? null;
}

function getConfigurationSet(): string | undefined {
  return process.env.SES_CONFIGURATION_SET?.trim() || undefined;
}

interface SendTrackedEmailParams {
  /** Recipient user id, or null for admin / system-recipient emails. */
  userId: string | null;
  /** Recipient address — always set, even when userId is null. */
  recipientEmail: string;
  rendered: RenderedEmail;
  templateId: string;
  /** Funnel-only fields; null for transactional + admin emails. */
  funnelId?: string | null;
  funnelStep?: number | null;
  variables: Record<string, string>;
  /**
   * When true, suppresses SES list-management headers (no unsubscribe link
   * appended). Required for password reset, email verification, and other
   * account-critical mail. Funnel/marketing emails set this false so the
   * SES contact-list footer is added.
   */
  isTransactional?: boolean;
  /** Reply-To, e.g. contact-form sender so admin can reply directly. */
  replyTo?: string;
}

/**
 * Send an email via SES and log it to email_logs.
 *
 * Inserts a `pending` row first, sends, then updates with the SES MessageId
 * (or `failed` + error on rejection). The MessageId is what the SES webhook
 * (`/api/webhooks/ses`) keys on for Delivery / Bounce / Complaint / Open /
 * Click events, so anything sent through this helper automatically gets
 * full engagement tracking — funnel and transactional alike.
 *
 * Returns the email_logs row id on success, null on any failure (SES not
 * configured, send rejected, etc.).
 */
export async function sendTrackedEmail(
  params: SendTrackedEmailParams,
): Promise<string | null> {
  const client = getSesClient();
  if (!client) {
    console.warn("[SES] Not configured — skipping email send");
    return null;
  }

  const [logRow] = await db
    .insert(emailLogs)
    .values({
      userId: params.userId,
      emailTemplateId: params.templateId,
      emailFunnelId: params.funnelId ?? null,
      funnelStep: params.funnelStep ?? null,
      recipientEmail: params.recipientEmail,
      subjectSnapshot: params.rendered.subject,
      variablesSnapshot: JSON.stringify(params.variables),
      status: "pending",
    })
    .returning({ id: emailLogs.id });

  try {
    const fromEmail = getSesFromEmailAddress();
    if (!fromEmail) {
      console.warn("[SES] SES_FROM_EMAIL is not a valid sender address");
      await db
        .update(emailLogs)
        .set({ status: "failed", errorMessage: "Invalid SES_FROM_EMAIL" })
        .where(eq(emailLogs.id, logRow.id));
      return null;
    }

    const replyTo = resolveReplyToAddress(params.replyTo);
    const input: SendEmailCommandInput = {
      FromEmailAddress: fromEmail,
      Destination: { ToAddresses: [params.recipientEmail] },
      ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
      Content: {
        Simple: {
          Subject: { Data: params.rendered.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: params.rendered.html, Charset: "UTF-8" },
            ...(params.rendered.text
              ? { Text: { Data: params.rendered.text, Charset: "UTF-8" } }
              : {}),
          },
        },
      },
      ConfigurationSetName: getConfigurationSet(),
    };

    // Marketing-class sends opt into SES list management so the unsubscribe
    // footer is appended; transactional sends (password reset, etc.) opt out.
    if (!params.isTransactional && process.env.SES_CONTACT_LIST) {
      input.ListManagementOptions = {
        ContactListName: process.env.SES_CONTACT_LIST,
      };
    }

    const result = await client.send(new SendEmailCommand(input));
    const messageId = result.MessageId ?? null;

    await db
      .update(emailLogs)
      .set({
        sesMessageId: messageId,
        status: "sent",
        sentAt: new Date(),
      })
      .where(eq(emailLogs.id, logRow.id));

    return logRow.id;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[SES] Send failed:", errMsg);
    await db
      .update(emailLogs)
      .set({ status: "failed", errorMessage: errMsg })
      .where(eq(emailLogs.id, logRow.id));
    return null;
  }
}

interface SendFunnelEmailParams {
  userId: string;
  recipientEmail: string;
  rendered: RenderedEmail;
  templateId: string;
  funnelId?: string;
  funnelStep?: number;
  variables: Record<string, string>;
  isTransactional?: boolean;
}

/**
 * Backwards-compatible wrapper for the funnel cron — preserves the prior
 * required-userId / funnelId shape so `funnel-send-service.ts` doesn't need
 * to change. New callers should use {@link sendTrackedEmail} directly.
 */
export async function sendFunnelEmail(
  params: SendFunnelEmailParams,
): Promise<string | null> {
  return sendTrackedEmail({
    userId: params.userId,
    recipientEmail: params.recipientEmail,
    rendered: params.rendered,
    templateId: params.templateId,
    funnelId: params.funnelId ?? null,
    funnelStep: params.funnelStep ?? null,
    variables: params.variables,
    isTransactional: params.isTransactional,
  });
}
