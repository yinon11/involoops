import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  businessEntities,
  emailLogs,
  notificationSentLog,
  shaamTenantReadiness,
  users,
} from "@/db/schema";
import { renderTemplate } from "@/lib/email/template-renderer";
import { sendTrackedEmail } from "@/lib/email/ses";
import { getTenantReadiness } from "./tenant-readiness";

/**
 * Spec 09 — tenant-facing email notifications for the SHAAM
 * onboarding + renewal lifecycle. Deduplicated via
 * `notification_sent_log` keyed on
 * `(business_entity_id, kind, dedupe_key)` so repeated cron runs on
 * the same day can't double-send.
 *
 * Locale resolution prefers the explicit user preference
 * (`users.preferred_locale`, set at signup or via the language picker).
 * Fallback is the historical heuristic — Israeli entities (any entity
 * with an `osekMurshe` set) get Hebrew, everyone else English.
 *
 * Templates live in `email_templates` keyed on
 * (`shaam-expiry-warning` | `shaam-expired` | `shaam-stuck`, locale).
 * Sends go through `sendTrackedEmail` so SES bounce/complaint events
 * surface in `email_logs` the same way funnel sends do.
 */

export type ShaamNotificationKind =
  | "expiry-warning-14d"
  | "expiry-warning-7d"
  | "expiry-warning-1d"
  | "expired"
  | "stuck"
  | "hearing-deadline";

const HE = "he";

function portalLink(): string {
  return `${
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000"
  }/settings/ita-integration`;
}

interface Recipient {
  email: string;
  locale: "he" | "en";
  userId: string | null;
}

async function resolveRecipient(businessEntityId: string): Promise<Recipient | null> {
  const [row] = await db
    .select({
      supportEmail: shaamTenantReadiness.supportContactEmail,
      ownerEmail: users.email,
      ownerId: users.id,
      ownerPreferredLocale: users.preferredLocale,
      osekMurshe: businessEntities.osekMurshe,
    })
    .from(businessEntities)
    .leftJoin(users, eq(users.id, businessEntities.ownerUserId))
    .leftJoin(
      shaamTenantReadiness,
      eq(shaamTenantReadiness.businessEntityId, businessEntities.id),
    )
    .where(eq(businessEntities.id, businessEntityId))
    .limit(1);
  if (!row) return null;
  const email = row.supportEmail ?? row.ownerEmail;
  if (!email) return null;
  // Prefer explicit user preference; fall back to the historical heuristic.
  const locale: "he" | "en" =
    row.ownerPreferredLocale === HE
      ? "he"
      : row.ownerPreferredLocale === "en"
        ? "en"
        : row.osekMurshe
          ? "he"
          : "en";
  // userId is the owner if we routed to the owner; null if we sent to a
  // distinct support contact address (engagement events for that mailbox
  // shouldn't be attributed to the owner user).
  const userId = email === row.ownerEmail ? row.ownerId ?? null : null;
  return { email, locale, userId };
}

async function alreadySent(
  businessEntityId: string,
  kind: ShaamNotificationKind,
  dedupeKey: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationSentLog.id })
    .from(notificationSentLog)
    .where(
      and(
        eq(notificationSentLog.businessEntityId, businessEntityId),
        eq(notificationSentLog.notificationKind, kind),
        eq(notificationSentLog.dedupeKey, dedupeKey),
      ),
    )
    .limit(1);
  return !!row;
}

async function sendAndLog(
  businessEntityId: string,
  kind: ShaamNotificationKind,
  dedupeKey: string,
  recipient: Recipient,
  templateCode: string,
  variables: Record<string, string>,
): Promise<void> {
  // Insert dedup row FIRST with a best-effort unique conflict catch —
  // the UNIQUE(business_entity_id, kind, dedupe_key) constraint means
  // a racing second caller can't double-send.
  try {
    await db.insert(notificationSentLog).values({
      businessEntityId,
      notificationKind: kind,
      dedupeKey,
      recipientEmail: recipient.email,
    });
  } catch {
    return; // already sent by a concurrent cron run
  }

  const rendered = await renderTemplate(
    templateCode,
    recipient.locale,
    variables,
  );
  if (!rendered) {
    console.error(
      `[shaam notifications] template missing: ${templateCode} (locale=${recipient.locale})`,
    );
    return;
  }

  const logId = await sendTrackedEmail({
    userId: recipient.userId,
    recipientEmail: recipient.email,
    rendered,
    templateId: rendered.templateId,
    variables,
    isTransactional: true,
  });
  if (!logId) {
    console.warn(
      `[shaam notifications] send returned no log id for ${kind} ${dedupeKey}`,
    );
    return;
  }

  // Mirror the SES message id into the dedup row for support / audit lookups.
  // Best-effort — sendTrackedEmail already wrote it into email_logs, this is
  // just a convenience cross-reference so the SHAAM dedup table stays useful
  // for ops without joining email_logs every time.
  try {
    const [logRow] = await db
      .select({ sesMessageId: emailLogs.sesMessageId })
      .from(emailLogs)
      .where(eq(emailLogs.id, logId))
      .limit(1);
    if (logRow?.sesMessageId) {
      await db
        .update(notificationSentLog)
        .set({ sesMessageId: logRow.sesMessageId })
        .where(
          and(
            eq(notificationSentLog.businessEntityId, businessEntityId),
            eq(notificationSentLog.notificationKind, kind),
            eq(notificationSentLog.dedupeKey, dedupeKey),
          ),
        );
    }
  } catch {
    // non-fatal — dedup still works without the cross-reference
  }
}

export async function sendReadinessExpiryWarning(
  businessEntityId: string,
  daysLeft: number,
): Promise<void> {
  const kind: ShaamNotificationKind =
    daysLeft <= 1
      ? "expiry-warning-1d"
      : daysLeft <= 7
        ? "expiry-warning-7d"
        : "expiry-warning-14d";
  const today = new Date().toISOString().slice(0, 10);
  const dedupeKey = `${kind}-${today}`;
  if (await alreadySent(businessEntityId, kind, dedupeKey)) return;
  const recipient = await resolveRecipient(businessEntityId);
  if (!recipient) return;
  await sendAndLog(
    businessEntityId,
    kind,
    dedupeKey,
    recipient,
    "shaam-expiry-warning",
    { daysLeft: String(daysLeft), portalUrl: portalLink() },
  );
}

export async function sendReadinessExpiredNotice(
  businessEntityId: string,
): Promise<void> {
  const kind: ShaamNotificationKind = "expired";
  const today = new Date().toISOString().slice(0, 10);
  const dedupeKey = `expired-${today}`;
  if (await alreadySent(businessEntityId, kind, dedupeKey)) return;
  const recipient = await resolveRecipient(businessEntityId);
  if (!recipient) return;
  await sendAndLog(
    businessEntityId,
    kind,
    dedupeKey,
    recipient,
    "shaam-expired",
    { portalUrl: portalLink() },
  );
}

export async function sendReadinessStuckReminder(
  businessEntityId: string,
): Promise<void> {
  const kind: ShaamNotificationKind = "stuck";
  // Weekly cadence — one nudge per ISO week.
  const weekStart = new Date();
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  const dedupeKey = `stuck-${weekStart.toISOString().slice(0, 10)}`;
  if (await alreadySent(businessEntityId, kind, dedupeKey)) return;
  // Only send if onboarding is actually stuck (at least one checklist
  // confirmation AND no ACTIVE authorization).
  const snapshot = await getTenantReadiness(businessEntityId);
  const hasAny =
    snapshot.checklist.azorIshiConfirmed ||
    snapshot.checklist.taagidRegistered ||
    snapshot.checklist.morsheAlAssigned;
  if (!hasAny) return;
  if (snapshot.state === "AUTHORIZED") return;
  const recipient = await resolveRecipient(businessEntityId);
  if (!recipient) return;
  await sendAndLog(
    businessEntityId,
    kind,
    dedupeKey,
    recipient,
    "shaam-stuck",
    { portalUrl: portalLink() },
  );
}

/**
 * Warn the seller that a שימוע window is about to close.
 *
 * Deliberately per-document rather than per-tenant: each hold carries its
 * own deadline, and a business can have several running at once. Deduped
 * on the document id plus the deadline, so re-running the cron is safe and
 * a deadline the ITA later moves produces exactly one fresh warning.
 *
 * Nothing here asserts what happens when the window closes — that rule is
 * still unconfirmed (see `docs/ita-compliance/shaam-rejection-plan.md` §8),
 * so the email points at the invoice and at the seller's accountant rather
 * than promising an outcome.
 */
export async function sendHearingDeadlineWarning(params: {
  businessEntityId: string;
  documentId: string;
  formattedNumber: string | null;
  deadline: Date;
}): Promise<boolean> {
  const kind: ShaamNotificationKind = "hearing-deadline";
  const dedupeKey = `hearing-${params.documentId}-${params.deadline
    .toISOString()
    .slice(0, 10)}`;
  if (await alreadySent(params.businessEntityId, kind, dedupeKey)) return false;
  const recipient = await resolveRecipient(params.businessEntityId);
  if (!recipient) return false;
  await sendAndLog(
    params.businessEntityId,
    kind,
    dedupeKey,
    recipient,
    "shaam-hearing-deadline",
    {
      documentNumber: params.formattedNumber ?? params.documentId,
      deadline: params.deadline.toISOString().slice(0, 10),
      portalUrl: portalLink(),
    },
  );
  return true;
}
