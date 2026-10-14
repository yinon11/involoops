/**
 * Register a Gmail push-notification watch for the invoice-intake mailbox.
 *
 * Run via the .mjs launcher (`node scripts/gmail-watch-register.mjs`)
 * which forwards to `npx tsx` so we can import from src/lib/gmail.
 *
 * IMPORTANT preconditions before running:
 *   1. Webhook is deployed and reachable at GMAIL_PUBSUB_AUDIENCE.
 *   2. Pub/Sub topic exists and the Gmail service account
 *      `gmail-api-push@system.gserviceaccount.com` has the
 *      `roles/pubsub.publisher` role on that topic.
 *   3. A push subscription on the topic targets the webhook URL with
 *      OIDC auth, audience = GMAIL_PUBSUB_AUDIENCE.
 *
 * The first push you receive after this runs may not include any
 * messages — the historyId returned by watch() is the floor; only
 * later activity yields new history entries. Send a real test email
 * AFTER seeing "watch registered" to verify end-to-end.
 */

// Load .env from the current working directory before any module that
// might read process.env. dotenv does not override already-set vars,
// so shell exports still win.
import "dotenv/config";

import { watchInbox, getInboxAddress } from "@/lib/gmail/client";
import { upsertWatchState } from "@/lib/gmail/watch-state";

async function main(): Promise<void> {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) {
    console.error("Missing required env: GMAIL_PUBSUB_TOPIC");
    process.exit(1);
  }
  if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(topic)) {
    console.error(
      "GMAIL_PUBSUB_TOPIC must look like 'projects/<id>/topics/<name>', got:",
      topic,
    );
    process.exit(1);
  }

  const inbox = getInboxAddress();
  console.log(`Registering watch on ${inbox} → ${topic} ...`);

  const { historyId, expiration } = await watchInbox(
    topic as `projects/${string}/topics/${string}`,
  );
  await upsertWatchState({
    mailboxEmail: inbox,
    lastHistoryId: historyId,
    watchExpiresAt: expiration,
  });

  console.log("");
  console.log("✅ watch registered");
  console.log("   mailbox     :", inbox);
  console.log("   topic       :", topic);
  console.log("   historyId   :", historyId);
  console.log("   expires at  :", expiration.toISOString());
  console.log("");
  console.log(
    "Send a test email to your alias address now — it should appear in",
  );
  console.log("inbound_email_log within a few seconds.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
