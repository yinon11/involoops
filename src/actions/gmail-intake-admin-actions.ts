"use server";

import { db } from "@/db";
import { gmailWatchState, inboundEmailLog } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";

export interface GmailIntakeStatus {
  mailboxEmail: string | null;
  lastHistoryId: string | null;
  watchExpiresAt: Date | null;
  /** Most recent row in inbound_email_log, or null if empty. */
  lastInbound: {
    receivedAt: Date;
    fromAddress: string | null;
    outcome: string;
  } | null;
  /** Last-24h histogram keyed by outcome. Empty object = no activity. */
  last24h: Record<string, number>;
}

/**
 * Admin-only health snapshot for the Gmail intake pipeline.
 *
 * Kept deliberately narrow in what it exposes — this page is for
 * operators verifying that mail is flowing, not for browsing
 * customer content. Only the most recent From address is surfaced so
 * admins can sanity-check the last hop; message bodies and
 * per-message IDs stay in the DB for audits.
 */
export async function getGmailIntakeStatus(): Promise<GmailIntakeStatus | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!(await isUserAdmin(session.user.id))) return null;

  const inboxEmail = process.env.GMAIL_INBOX_ADDRESS ?? null;

  const stateRows = inboxEmail
    ? await db
        .select()
        .from(gmailWatchState)
        .where(eq(gmailWatchState.mailboxEmail, inboxEmail))
        .limit(1)
    : [];
  const state = stateRows[0];

  const [lastInbound] = await db
    .select({
      receivedAt: inboundEmailLog.receivedAt,
      fromAddress: inboundEmailLog.fromAddress,
      outcome: inboundEmailLog.outcome,
    })
    .from(inboundEmailLog)
    .orderBy(desc(inboundEmailLog.receivedAt))
    .limit(1);

  // 24h outcome histogram. Cap the read at 500 rows — more than enough
  // for an admin-facing status card and bounds the memory footprint
  // if activity ever spikes.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db
    .select({
      outcome: inboundEmailLog.outcome,
      receivedAt: inboundEmailLog.receivedAt,
    })
    .from(inboundEmailLog)
    .orderBy(desc(inboundEmailLog.receivedAt))
    .limit(500);

  const last24h: Record<string, number> = {};
  for (const r of recent) {
    if (r.receivedAt.getTime() < since.getTime()) break; // rows are DESC
    last24h[r.outcome] = (last24h[r.outcome] ?? 0) + 1;
  }

  return {
    mailboxEmail: state?.mailboxEmail ?? inboxEmail,
    lastHistoryId: state?.lastHistoryId ?? null,
    watchExpiresAt: state?.watchExpiresAt ?? null,
    lastInbound: lastInbound
      ? {
          receivedAt: lastInbound.receivedAt,
          fromAddress: lastInbound.fromAddress,
          outcome: lastInbound.outcome,
        }
      : null,
    last24h,
  };
}
