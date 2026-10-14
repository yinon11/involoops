import { db } from "@/db";
import { users } from "@/db/schema/users";
import { eq } from "drizzle-orm";
import { renderTemplate } from "./template-renderer";
import { sendTrackedEmail } from "./ses";

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

/**
 * Where operator notifications go, or null when the operator has not set one.
 *
 * Deliberately has no fallback. A hardcoded address here would mean every
 * deployment that leaves ADMIN_EMAIL unset mails whoever is baked in — sending
 * that operator's signups, contact-form messages and error reports to a third
 * party who never asked for them. Unset means these notifications are skipped.
 */
export function getAdminEmail(): string | null {
  return process.env.ADMIN_EMAIL?.trim() || null;
}

/** Logged on each skipped send, so the silence is diagnosable. */
export function warnNoAdminEmail(what: string): void {
  console.warn(`[email] ADMIN_EMAIL is not set — skipping ${what}`);
}

type SendResult = { ok: true } | { ok: false; error: string };

type SupportedLocale = "en" | "he";
function normalizeLocale(input?: string | null): SupportedLocale {
  return input === "he" ? "he" : "en";
}

/**
 * Render a DB-stored template + send via SES + log to email_logs.
 *
 * If the template row is missing the send fails — there is no inline TS
 * fallback. This is the deliberate trade-off (option (a)): a single source
 * of truth for content, at the cost of a hard dependency on the seed having
 * run. Bad seed runs surface immediately as failed sends rather than silently
 * masking missing templates.
 */
async function sendFromTemplate(params: {
  code: string;
  locale: string;
  variables: Record<string, string>;
  to: string;
  /** Recipient user id, or null for admin / anonymous recipients. */
  userId: string | null;
  replyTo?: string;
  /**
   * When true, suppresses SES list-management headers (no unsubscribe footer).
   * Defaults to true for transactional helpers — they're all account-critical
   * or admin-only. Funnel/marketing sends use sendFunnelEmail directly.
   */
  isTransactional?: boolean;
}): Promise<SendResult> {
  // Inject appUrl so DB templates can reference {{appUrl}}/brand/... for the
  // logo image without every transactional helper having to thread it through.
  // Caller-supplied appUrl wins so test/preview tools can override.
  const variables = {
    appUrl: appOrigin(),
    ...params.variables,
  };

  const rendered = await renderTemplate(
    params.code,
    params.locale,
    variables,
  );
  if (!rendered) {
    const msg = `Template not found: ${params.code} (locale=${params.locale})`;
    console.error(`[email] ${msg}`);
    return { ok: false, error: msg };
  }

  const logId = await sendTrackedEmail({
    userId: params.userId,
    recipientEmail: params.to,
    rendered,
    templateId: rendered.templateId,
    variables,
    isTransactional: params.isTransactional ?? true,
    replyTo: params.replyTo,
  });

  if (!logId) {
    return { ok: false, error: "Email is not configured (SES credentials)." };
  }
  return { ok: true };
}

// ── User-facing transactional emails ────────────────────────────────

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  locale?: string | null,
  userId?: string | null,
): Promise<SendResult> {
  const link = `${appOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
  return sendFromTemplate({
    code: "pwd-reset",
    locale: normalizeLocale(locale),
    variables: { resetUrl: link },
    to,
    userId: userId ?? null,
  });
}

export async function sendEmailVerificationEmail(
  to: string,
  name: string | null,
  token: string,
  locale?: string | null,
  userId?: string | null,
): Promise<SendResult> {
  const link = `${appOrigin()}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(to)}`;
  const lang = normalizeLocale(locale);
  const greetingName = name?.trim()
    ? name.trim()
    : lang === "he"
      ? "שלום"
      : "there";
  return sendFromTemplate({
    code: "email-verify",
    locale: lang,
    variables: { userName: greetingName, verifyUrl: link },
    to,
    userId: userId ?? null,
  });
}

export async function sendAuthorizedSenderVerificationEmail(params: {
  to: string;
  token: string;
  /** Display name of the account owner requesting authorisation. */
  ownerName: string | null;
  ownerEmail: string;
  locale?: string | null;
}): Promise<SendResult> {
  const { to, token, ownerName, ownerEmail, locale } = params;
  const link = `${appOrigin()}/verify/authorized-sender?token=${encodeURIComponent(token)}&email=${encodeURIComponent(to)}`;
  const owner = ownerName?.trim() ? ownerName.trim() : ownerEmail;
  return sendFromTemplate({
    code: "authorized-sender-verify",
    locale: normalizeLocale(locale),
    variables: { ownerName: owner, ownerEmail, verifyUrl: link },
    to,
    // Recipient may not be a registered user — log against the sender's row is
    // not meaningful here, so leave userId null (matches password-reset style).
    userId: null,
  });
}

// ── Admin-recipient notifications (English only) ────────────────────

export async function sendContactMessage(params: {
  name: string;
  email: string;
  subject?: string | null;
  message: string;
}): Promise<SendResult> {
  const { name, email, subject, message } = params;
  const subjectLine = subject?.trim() ? subject.trim() : "(no subject)";
  const admin = getAdminEmail();
  if (!admin) {
    warnNoAdminEmail("contact-form notification");
    return { ok: false, error: "ADMIN_EMAIL is not configured" };
  }
  return sendFromTemplate({
    code: "admin-contact-message",
    locale: "en",
    variables: {
      senderName: name,
      senderEmail: email,
      subject: subjectLine,
      message,
    },
    to: admin,
    replyTo: email,
    userId: null,
  });
}

export async function sendNewUserSignupNotification(params: {
  name: string | null;
  email: string | null;
  provider: "credentials" | "google" | "oauth";
}): Promise<SendResult> {
  const admin = getAdminEmail();
  if (!admin) {
    warnNoAdminEmail("new-signup notification");
    return { ok: false, error: "ADMIN_EMAIL is not configured" };
  }
  return sendFromTemplate({
    code: "admin-new-signup",
    locale: "en",
    variables: {
      userName: params.name ?? "(no name)",
      userEmail: params.email ?? "(no email)",
      provider: params.provider,
    },
    to: admin,
    userId: null,
  });
}

export async function sendUserSetOwnKeyNotification(params: {
  name: string | null;
  email: string | null;
  hint: string | null;
}): Promise<SendResult> {
  const admin = getAdminEmail();
  if (!admin) {
    warnNoAdminEmail("BYOK-key notification");
    return { ok: false, error: "ADMIN_EMAIL is not configured" };
  }
  return sendFromTemplate({
    code: "admin-user-set-byok-key",
    locale: "en",
    variables: {
      userName: params.name ?? "(no name)",
      userEmail: params.email ?? "(no email)",
      keyHint: params.hint?.trim() || "(hint unavailable)",
    },
    to: admin,
    userId: null,
  });
}

export async function sendNewSubscriptionNotification(params: {
  name: string | null;
  email: string | null;
  tier: string | null;
  amount?: string | null;
}): Promise<SendResult> {
  const admin = getAdminEmail();
  if (!admin) {
    warnNoAdminEmail("new-subscription notification");
    return { ok: false, error: "ADMIN_EMAIL is not configured" };
  }
  return sendFromTemplate({
    code: "admin-new-subscription",
    locale: "en",
    variables: {
      userName: params.name ?? "(no name)",
      userEmail: params.email ?? "(no email)",
      tier: params.tier?.trim() || "(unknown tier)",
      amount: params.amount?.trim() || "",
    },
    to: admin,
    userId: null,
  });
}

// ── Invoice scan confirmation (per-user, en + he) ───────────────────

export interface ScannedInvoiceSummary {
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: string | null;
  currency: string | null;
  fileName: string | null;
  status: string | null;
}

function formatAmount(
  amount: string | null,
  currency: string | null,
  locale: "en" | "he",
): string {
  if (!amount) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  const tag = locale === "he" ? "he-IL" : "en-US";
  try {
    return new Intl.NumberFormat(tag, {
      style: "currency",
      currency: (currency || "ILS").toUpperCase(),
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/**
 * Build the per-invoice card HTML rows. Returned as a single string and
 * passed to the template via the {{{invoiceCards}}} raw placeholder so the
 * renderer doesn't HTML-escape it. Labels come from this function (locale
 * aware) so the template body can stay free of conditional logic.
 */
function buildInvoiceCardsHtml(
  invoices: ScannedInvoiceSummary[],
  locale: "en" | "he",
): string {
  const labels =
    locale === "he"
      ? {
          vendor: "ספק",
          invoiceNumber: "מספר חשבונית",
          invoiceDate: "תאריך",
          amount: "סכום",
          file: "קובץ",
          status: "סטטוס",
        }
      : {
          vendor: "Vendor",
          invoiceNumber: "Invoice #",
          invoiceDate: "Date",
          amount: "Amount",
          file: "File",
          status: "Status",
        };
  const dash = "—";
  return invoices
    .map((inv) => {
      const vendor = inv.vendorName?.trim()
        ? escapeHtml(inv.vendorName.trim())
        : dash;
      const num = inv.invoiceNumber?.trim()
        ? escapeHtml(inv.invoiceNumber.trim())
        : dash;
      const date = inv.invoiceDate ? escapeHtml(inv.invoiceDate) : dash;
      const amt = escapeHtml(formatAmount(inv.amount, inv.currency, locale));
      const file = inv.fileName?.trim() ? escapeHtml(inv.fileName.trim()) : dash;
      const status = inv.status ? escapeHtml(inv.status) : dash;
      return `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:12px 0;border:1px solid #e5e7eb;border-radius:6px;border-collapse:separate;">
          <tr><td style="padding:8px 12px;"><strong>${labels.file}:</strong> ${file}</td></tr>
          <tr><td style="padding:8px 12px;"><strong>${labels.vendor}:</strong> ${vendor}</td></tr>
          <tr><td style="padding:8px 12px;"><strong>${labels.invoiceNumber}:</strong> ${num}</td></tr>
          <tr><td style="padding:8px 12px;"><strong>${labels.invoiceDate}:</strong> ${date}</td></tr>
          <tr><td style="padding:8px 12px;"><strong>${labels.amount}:</strong> ${amt}</td></tr>
          <tr><td style="padding:8px 12px;"><strong>${labels.status}:</strong> ${status}</td></tr>
        </table>`;
    })
    .join("");
}

export async function sendInvoiceScanConfirmation(params: {
  to: string;
  name: string | null;
  locale: "en" | "he";
  subject: string | null;
  invoices: ScannedInvoiceSummary[];
}): Promise<SendResult> {
  const { to, name, locale, subject, invoices } = params;
  const greetingName = name?.trim()
    ? name.trim()
    : locale === "he"
      ? "שלום"
      : "there";

  const cardsHtml = buildInvoiceCardsHtml(invoices, locale);

  // Resolve recipient userId by email so the engagement webhook can attach
  // bounce/complaint events to the right account. Best-effort — Gmail intake
  // can run for users we still know about; if no user is found we log
  // anyway with NULL userId.
  const userRow = await db.query.users.findFirst({
    where: eq(users.email, to),
    columns: { id: true },
  });

  return sendFromTemplate({
    code: "invoice-scan-confirm",
    locale,
    variables: {
      userName: greetingName,
      invoiceCount: String(invoices.length),
      srcSubject: subject?.trim() ?? "",
      hasSrcSubject: subject?.trim() ? "true" : "",
      invoiceCards: cardsHtml,
    },
    to,
    userId: userRow?.id ?? null,
  });
}

export async function sendInvoiceIntakeFailureEmail(params: {
  to: string;
  name: string | null;
  locale: "en" | "he";
  userId: string | null;
  subject: string | null;
  reason: string;
  errorDetail: string;
}): Promise<SendResult> {
  const greetingName = params.name?.trim()
    ? params.name.trim()
    : params.locale === "he"
      ? "שלום"
      : "there";

  return sendFromTemplate({
    code: "invoice-intake-failure",
    locale: params.locale,
    variables: {
      userName: greetingName,
      srcSubject: params.subject?.trim() || (params.locale === "he" ? "(ללא נושא)" : "(no subject)"),
      reason: params.reason,
      errorDetail:
        params.errorDetail ||
        (params.locale === "he" ? "—" : "—"),
    },
    to: params.to,
    userId: params.userId,
  });
}
