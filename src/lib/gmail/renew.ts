/**
 * Shared Gmail watch-renewal helper. Called from two places:
 *   1. src/instrumentation.ts — once per server boot
 *   2. src/app/api/webhooks/gmail/route.ts — after processing each push
 *
 * Both are "best effort" — failures are logged, never thrown, so they
 * can't crash startup or fail a Pub/Sub ack.
 *
 * Renews when less than `RENEW_THRESHOLD_MS` remains on the watch
 * (default 2 days). `users.watch()` on an active watch is a no-op
 * that resets the expiry, so calling redundantly is safe.
 */

import { watchInbox, getInboxAddress } from "@/lib/gmail/client";
import { getWatchState, upsertWatchState } from "@/lib/gmail/watch-state";

export const RENEW_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

export type RenewAction =
  | "renewed"
  | "skip"
  | "no-topic"
  | "no-state"
  | "error";

export interface RenewResult {
  action: RenewAction;
  mailbox: string | null;
  msUntilExpiry: number | null;
  error?: string;
}

/**
 * Check the watch state for the configured inbox and renew if near
 * expiry. Never throws.
 */
export async function renewWatchIfExpiring(): Promise<RenewResult> {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) {
    return { action: "no-topic", mailbox: null, msUntilExpiry: null };
  }

  let mailbox: string;
  try {
    mailbox = getInboxAddress();
  } catch {
    // GMAIL_INBOX_ADDRESS unset — feature intentionally disabled.
    return { action: "no-topic", mailbox: null, msUntilExpiry: null };
  }

  try {
    const state = await getWatchState(mailbox);
    // No row yet — the operator needs to run the registration script.
    // Renewing here would succeed but mask the setup step.
    if (!state) {
      return { action: "no-state", mailbox, msUntilExpiry: null };
    }

    const msUntilExpiry =
      (state.watchExpiresAt?.getTime() ?? 0) - Date.now();

    if (msUntilExpiry > RENEW_THRESHOLD_MS) {
      return { action: "skip", mailbox, msUntilExpiry };
    }

    const { expiration } = await watchInbox(
      topic as `projects/${string}/topics/${string}`,
    );
    await upsertWatchState({
      mailboxEmail: mailbox,
      watchExpiresAt: expiration,
    });
    return {
      action: "renewed",
      mailbox,
      msUntilExpiry: expiration.getTime() - Date.now(),
    };
  } catch (err) {
    return {
      action: "error",
      mailbox,
      msUntilExpiry: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
