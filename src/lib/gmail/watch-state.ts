/**
 * Read/update helpers for the `gmail_watch_state` row tracking one
 * mailbox's history checkpoint and watch expiry.
 *
 * Always keyed by `mailbox_email` (UNIQUE) so we can have multiple
 * mailboxes later without code changes.
 */

import { db } from "@/db";
import { gmailWatchState } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface WatchState {
  mailboxEmail: string;
  lastHistoryId: string | null;
  watchExpiresAt: Date | null;
}

export async function getWatchState(
  mailboxEmail: string,
): Promise<WatchState | null> {
  const rows = await db
    .select()
    .from(gmailWatchState)
    .where(eq(gmailWatchState.mailboxEmail, mailboxEmail))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    mailboxEmail: row.mailboxEmail,
    lastHistoryId: row.lastHistoryId,
    watchExpiresAt: row.watchExpiresAt,
  };
}

/**
 * Upsert the watch checkpoint. Called after every successful webhook
 * processing (lastHistoryId) and after every watch() registration
 * (watchExpiresAt + initial lastHistoryId).
 */
export async function upsertWatchState(params: {
  mailboxEmail: string;
  lastHistoryId?: string | null;
  watchExpiresAt?: Date | null;
}): Promise<void> {
  const { mailboxEmail, lastHistoryId, watchExpiresAt } = params;

  await db
    .insert(gmailWatchState)
    .values({
      mailboxEmail,
      lastHistoryId: lastHistoryId ?? null,
      watchExpiresAt: watchExpiresAt ?? null,
    })
    .onConflictDoUpdate({
      target: gmailWatchState.mailboxEmail,
      set: {
        ...(lastHistoryId !== undefined ? { lastHistoryId } : {}),
        ...(watchExpiresAt !== undefined ? { watchExpiresAt } : {}),
        updatedAt: new Date(),
      },
    });
}
