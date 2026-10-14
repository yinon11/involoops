/**
 * Notify the account owner and the email sender when Gmail invoice intake
 * fails. Owner alerts are deduped to at most one per Israel calendar day;
 * senders get a notice for each failed message.
 */

import { db } from "@/db";
import { emailLogs, emailTemplates, users, invoices } from "@/db/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { isLocale } from "@/lib/i18n/config";
import { todayInIsrael, israelDateString } from "@/lib/datetime/today";
import { getInboxAddress } from "@/lib/gmail/client";
import { sendInvoiceIntakeFailureEmail } from "./transactional";

const TEMPLATE_CODE = "invoice-intake-failure";

export type IntakeFailureOutcome =
  | "unknown_sender"
  | "dkim_fail"
  | "over_limit"
  | "no_attachment"
  | "no_valid_attachment"
  | "error";

type SupportedLocale = "en" | "he";

function outcomeDescription(
  outcome: IntakeFailureOutcome,
  locale: SupportedLocale,
): string {
  const en: Record<IntakeFailureOutcome, string> = {
    unknown_sender:
      "We couldn't match this email to a registered Involoops account. Check Settings → Email forwarding for your personal address.",
    dkim_fail:
      "The email failed authentication (DKIM). Try sending directly from your mail provider, or re-forward the message without altering headers.",
    over_limit: "You've reached your monthly invoice limit.",
    no_attachment: "The email had no file attachments.",
    no_valid_attachment:
      "None of the attachments could be processed as an invoice.",
    error:
      "An unknown error occurred while processing your email. We received an alert about this failure and our team is investigating it.",
  };
  const he: Record<IntakeFailureOutcome, string> = {
    unknown_sender:
      "לא הצלחנו לשייך את המייל לחשבון Involoops רשום. בדקו בהגדרות → העברת מייל את כתובת ההעברה האישית.",
    dkim_fail:
      "המייל נכשל באימות (DKIM). נסו לשלוח ישירות מספק המייל, או להעביר מחדש בלי לשנות כותרות.",
    over_limit: "הגעתם למכסת החשבוניות החודשית.",
    no_attachment: "למייל לא היו קבצים מצורפים.",
    no_valid_attachment: "לא ניתן היה לעבד אף קובץ מצורף כחשבונית.",
    error:
      "אירעה שגיאה לא ידועה בעת עיבוד המייל. קיבלנו התראה על התקלה ואנחנו בודקים את הנושא.",
  };
  return (locale === "he" ? he : en)[outcome];
}

const DUPLICATE_INVOICE_RE =
  /duplicate of invoice ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const INTERNAL_ERROR_MARKERS = [
  /Failed query:/i,
  /\binsert into\b/i,
  /\bparams:\s/i,
  /\breturning\b/i,
  /\$[0-9]+\s*,/,
  /\bextracted_text\b/i,
  /\bllm_(input|output)_tokens\b/i,
  /\buser_id\b.*\bvendor_id\b/i,
  /Page \d+ of \d+/,
];

function isDuplicateError(errorMessage: string | null | undefined): boolean {
  return !!errorMessage && DUPLICATE_INVOICE_RE.test(errorMessage);
}

function looksLikeInternalError(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length > 400) return true;
  return INTERNAL_ERROR_MARKERS.some((re) => re.test(trimmed));
}

function splitErrorSegments(errorMessage: string): string[] {
  return errorMessage
    .split(/\s*\|\s*|\s*;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseFilePrefixedError(segment: string): { fileLabel: string; body: string } {
  const colonIdx = segment.indexOf(": ");
  if (colonIdx > 0 && colonIdx <= 120) {
    return {
      fileLabel: segment.slice(0, colonIdx).trim(),
      body: segment.slice(colonIdx + 2).trim(),
    };
  }
  return { fileLabel: "", body: segment.trim() };
}

function mapKnownCustomerError(body: string, locale: SupportedLocale): string | null {
  if (/^exceeds \d+ bytes/i.test(body)) {
    return locale === "he"
      ? "הקובץ חורג ממגבלת 25 MB."
      : "File exceeds the 25 MB size limit.";
  }
  if (/^unsupported extension$/i.test(body)) {
    return locale === "he"
      ? "סוג קובץ לא נתמך. ניתן לשלוח PDF, תמונות או ZIP."
      : "Unsupported file type. We accept PDF, images, and ZIP archives.";
  }
  if (/^bytes do not match accepted type$/i.test(body)) {
    return locale === "he"
      ? "תוכן הקובץ אינו תואם פורמט חשבונית נתמך."
      : "File content doesn't match a supported invoice format.";
  }
  if (/^plan limit reached$/i.test(body)) {
    return locale === "he"
      ? "הגעתם למכסת החשבוניות החודשית."
      : "Monthly invoice limit reached.";
  }
  if (/^unknown error$/i.test(body)) {
    return locale === "he"
      ? "שגיאה לא ידועה — הצוות שלנו קיבל התראה."
      : "Unknown error — our team has been alerted.";
  }
  return null;
}

async function formatDuplicateSegment(
  body: string,
  locale: SupportedLocale,
): Promise<string> {
  const match = body.match(DUPLICATE_INVOICE_RE);
  const existingId = match?.[1];
  let existingLabel = existingId ?? "";
  if (existingId) {
    const [row] = await db
      .select({
        invoiceNumber: invoices.invoiceNumber,
        fileName: invoices.fileName,
        invoiceDate: invoices.invoiceDate,
      })
      .from(invoices)
      .where(eq(invoices.id, existingId))
      .limit(1);
    if (row) {
      const parts = [
        row.invoiceNumber?.trim(),
        row.invoiceDate?.trim(),
        row.fileName?.trim(),
      ].filter(Boolean);
      if (parts.length > 0) existingLabel = parts.join(" · ");
    }
  }

  return locale === "he"
    ? body.replace(
        DUPLICATE_INVOICE_RE,
        existingLabel
          ? `כבר קיים במערכת: ${existingLabel}`
          : "כבר קיים במערכת",
      )
    : body.replace(
        DUPLICATE_INVOICE_RE,
        existingLabel
          ? `already in your account: ${existingLabel}`
          : "already in your account",
      );
}

async function sanitizeErrorSegment(
  segment: string,
  locale: SupportedLocale,
): Promise<{ text: string; internal: boolean; duplicate: boolean }> {
  const { fileLabel, body } = parseFilePrefixedError(segment);
  const withFile = (msg: string) => (fileLabel ? `${fileLabel}: ${msg}` : msg);

  if (isDuplicateError(body)) {
    return {
      text: withFile(await formatDuplicateSegment(body, locale)),
      internal: false,
      duplicate: true,
    };
  }

  if (looksLikeInternalError(body) || looksLikeInternalError(segment)) {
    console.error(
      "[gmail.intake] internal intake error (hidden from customer):",
      segment,
    );
    return {
      text: withFile(
        locale === "he"
          ? "לא הצלחנו לשמור את החשבונית — הצוות שלנו קיבל התראה."
          : "We couldn't save this invoice — our team has been notified.",
      ),
      internal: true,
      duplicate: false,
    };
  }

  const mapped = mapKnownCustomerError(body, locale);
  if (mapped) {
    return { text: withFile(mapped), internal: false, duplicate: false };
  }

  if (body.length <= 240) {
    return { text: withFile(body), internal: false, duplicate: false };
  }

  console.error(
    "[gmail.intake] long intake error truncated for customer:",
    segment,
  );
  return {
    text: withFile(
      locale === "he"
        ? "לא הצלחנו לעבד את הקובץ — הצוות שלנו קיבל התראה."
        : "We couldn't process this file — our team has been notified.",
    ),
    internal: true,
    duplicate: false,
  };
}

async function sanitizeCustomerErrorMessage(
  errorMessage: string | null,
  locale: SupportedLocale,
): Promise<{
  errorDetail: string;
  hadInternalError: boolean;
  duplicateOnly: boolean;
}> {
  const trimmed = errorMessage?.trim() ?? "";
  if (!trimmed) {
    return { errorDetail: "", hadInternalError: false, duplicateOnly: false };
  }

  const segments = splitErrorSegments(trimmed);
  const sanitized = await Promise.all(
    segments.map((segment) => sanitizeErrorSegment(segment, locale)),
  );

  return {
    errorDetail: sanitized.map((s) => s.text).join(" | "),
    hadInternalError: sanitized.some((s) => s.internal),
    duplicateOnly:
      sanitized.length > 0 && sanitized.every((s) => s.duplicate),
  };
}

async function resolveFailureCopy(params: {
  outcome: IntakeFailureOutcome;
  errorMessage: string | null;
  locale: SupportedLocale;
}): Promise<{ reason: string; errorDetail: string }> {
  const { outcome, errorMessage, locale } = params;
  const {
    errorDetail,
    hadInternalError,
    duplicateOnly,
  } = await sanitizeCustomerErrorMessage(errorMessage, locale);

  if (duplicateOnly) {
    return {
      reason:
        locale === "he"
          ? "החשבונית כבר קיימת בחשבון שלך (קובץ כפול)."
          : "This invoice was already uploaded to your account (duplicate file).",
      errorDetail: errorDetail || (locale === "he" ? "—" : "—"),
    };
  }

  if (hadInternalError && outcome === "no_valid_attachment") {
    return {
      reason:
        locale === "he"
          ? "קראנו את הקובץ המצורף אך לא הצלחנו להוסיף אותו לחשבון."
          : "We read your attachment but couldn't add it to your account.",
      errorDetail:
        errorDetail ||
        (locale === "he"
          ? "שגיאה פנימית — הצוות שלנו קיבל התראה."
          : "Internal error — our team has been alerted."),
    };
  }

  const fallbackDetail =
    outcome === "error"
      ? locale === "he"
        ? "שגיאה לא ידועה — הצוות שלנו קיבל התראה."
        : "Unknown error — our team has been alerted."
      : locale === "he"
        ? "—"
        : "—";

  return {
    reason: outcomeDescription(outcome, locale),
    errorDetail: errorDetail || fallbackDetail,
  };
}

function isReplyableSenderAddress(address: string | null | undefined): address is string {
  if (!address) return false;
  const lower = address.toLowerCase();
  if (lower === getInboxAddress().toLowerCase()) return false;
  if (lower.startsWith("noreply") || lower.startsWith("no-reply")) return false;
  if (lower.includes("mailer-daemon") || lower.includes("postmaster@")) return false;
  return true;
}

/** Start of the current Israel civil day (UTC instant). */
function startOfIsraelDay(now = new Date()): Date {
  const day = todayInIsrael();
  const probe = new Date(now);
  let guard = 0;
  while (israelDateString(probe) === day && guard < 2880) {
    probe.setMinutes(probe.getMinutes() - 1);
    guard++;
  }
  probe.setMinutes(probe.getMinutes() + 1);
  return probe;
}

async function alreadyNotifiedOwnerToday(userId: string): Promise<boolean> {
  const templateRows = await db
    .select({ id: emailTemplates.id })
    .from(emailTemplates)
    .where(eq(emailTemplates.code, TEMPLATE_CODE));
  const templateIds = templateRows.map((r) => r.id);
  if (templateIds.length === 0) return false;

  const since = startOfIsraelDay();
  const [row] = await db
    .select({ id: emailLogs.id })
    .from(emailLogs)
    .where(
      and(
        eq(emailLogs.userId, userId),
        inArray(emailLogs.emailTemplateId, templateIds),
        gte(emailLogs.createdAt, since),
      ),
    )
    .limit(1);

  return !!row;
}

async function resolveLocaleForEmail(
  email: string,
  matchedUserId: string | null,
): Promise<{ locale: SupportedLocale; name: string | null; userId: string | null }> {
  if (matchedUserId) {
    const row = await db
      .select({
        name: users.name,
        preferredLocale: users.preferredLocale,
      })
      .from(users)
      .where(eq(users.id, matchedUserId))
      .limit(1);
    const u = row[0];
    if (u) {
      return {
        locale: isLocale(u.preferredLocale) ? u.preferredLocale : "en",
        name: u.name,
        userId: matchedUserId,
      };
    }
  }

  const row = await db
    .select({
      id: users.id,
      name: users.name,
      preferredLocale: users.preferredLocale,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  const u = row[0];
  if (u) {
    return {
      locale: isLocale(u.preferredLocale) ? u.preferredLocale : "en",
      name: u.name,
      userId: u.id,
    };
  }

  return { locale: "en", name: null, userId: null };
}

async function sendFailureEmail(params: {
  to: string;
  matchedUserId: string | null;
  outcome: IntakeFailureOutcome;
  errorMessage: string | null;
  subject: string | null;
}): Promise<void> {
  const { locale, name, userId } = await resolveLocaleForEmail(
    params.to,
    params.matchedUserId,
  );

  const { reason, errorDetail } = await resolveFailureCopy({
    outcome: params.outcome,
    errorMessage: params.errorMessage,
    locale,
  });

  const result = await sendInvoiceIntakeFailureEmail({
    to: params.to,
    name,
    locale,
    userId: userId ?? null,
    subject: params.subject,
    reason,
    errorDetail,
  });

  if (!result.ok) {
    console.error(
      `[gmail.intake] failure notification to ${params.to} failed:`,
      result.error,
    );
  }
}

export interface IntakeFailureNotifyParams {
  outcome: IntakeFailureOutcome;
  errorMessage?: string | null;
  subject?: string | null;
  fromAddress?: string | null;
  matchedUserId?: string | null;
}

/**
 * Best-effort alerts to owner (≤1/day) and sender (each failure).
 * Never throws.
 */
export async function notifyIntakeFailure(
  params: IntakeFailureNotifyParams,
): Promise<void> {
  try {
    const matchedUserId = params.matchedUserId ?? null;
    const errorMessage = params.errorMessage ?? null;
    let ownerEmail: string | null = null;

    if (matchedUserId) {
      const skipOwner = await alreadyNotifiedOwnerToday(matchedUserId);
      if (!skipOwner) {
        const owner = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, matchedUserId))
          .limit(1);
        ownerEmail = owner[0]?.email?.trim().toLowerCase() ?? null;
        if (ownerEmail) {
          await sendFailureEmail({
            to: ownerEmail,
            matchedUserId,
            outcome: params.outcome,
            errorMessage,
            subject: params.subject ?? null,
          });
        }
      }
    }

    const sender = isReplyableSenderAddress(params.fromAddress)
      ? params.fromAddress.trim()
      : null;
    if (!sender) return;

    const senderLower = sender.toLowerCase();
    if (ownerEmail && senderLower === ownerEmail) return;

    await sendFailureEmail({
      to: sender,
      matchedUserId,
      outcome: params.outcome,
      errorMessage,
      subject: params.subject ?? null,
    });
  } catch (err) {
    console.error("[gmail.intake] failure notification failed", err);
  }
}

/** @deprecated Use notifyIntakeFailure */
export async function notifyUserOfIntakeFailure(params: {
  userId: string;
  outcome: IntakeFailureOutcome;
  errorMessage?: string | null;
  subject?: string | null;
  fromAddress?: string | null;
}): Promise<void> {
  return notifyIntakeFailure({
    matchedUserId: params.userId,
    outcome: params.outcome,
    errorMessage: params.errorMessage,
    subject: params.subject,
    fromAddress: params.fromAddress,
  });
}
