/**
 * Thin typed wrapper around the Gmail API for the invoice-intake mailbox.
 *
 * One mailbox per process (`GMAIL_INBOX_ADDRESS`). Auth is a stored
 * refresh token from the one-shot OAuth flow in `scripts/gmail-auth.mjs`.
 *
 * What's NOT here on purpose:
 *   - Rate-limit / retry helpers (Gmail API is generous; the webhook
 *     reads at most a few messages per push)
 *   - Decoded payload helpers — the webhook decodes bodies & attachments
 *     itself because each call needs different fields
 *   - Any caching — the OAuth client caches access tokens in memory,
 *     and beyond that we always want fresh server-side reads
 */

import { gmail_v1, gmail } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";

/**
 * Pub/Sub-style topic resource name for `users.watch()`. Format:
 * `projects/<project-id>/topics/<topic-name>`.
 */
type TopicName = `projects/${string}/topics/${string}`;

let cachedClient: gmail_v1.Gmail | null = null;

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. The Gmail intake mailbox is not configured.`,
    );
  }
  return v;
}

/**
 * Lazy-initialised Gmail client. Reuses the same OAuth2Client across
 * calls so the access-token cache is shared and we don't refresh once
 * per call. Throws if the four GMAIL_OAUTH_* env vars aren't all set.
 */
export function getGmailClient(): gmail_v1.Gmail {
  if (cachedClient) return cachedClient;

  const auth = new OAuth2Client({
    clientId: readEnv("GMAIL_OAUTH_CLIENT_ID"),
    clientSecret: readEnv("GMAIL_OAUTH_CLIENT_SECRET"),
  });
  auth.setCredentials({
    refresh_token: readEnv("GMAIL_OAUTH_REFRESH_TOKEN"),
  });

  cachedClient = gmail({ version: "v1", auth });
  return cachedClient;
}

/** Address of the intake inbox this instance operates (GMAIL_INBOX_ADDRESS). */
export function getInboxAddress(): string {
  return readEnv("GMAIL_INBOX_ADDRESS");
}

/**
 * Subscribe the inbox to push notifications on a Pub/Sub topic. Returns
 * the historyId at the moment the watch was registered — the FIRST
 * notification we receive will reference a historyId AFTER this one,
 * so save this as `gmail_watch_state.last_history_id` immediately.
 *
 * Watches expire after 7 days; renewed by the cron route. Calling
 * `watch()` on an already-watched mailbox is fine — Google replaces the
 * existing watch and resets the expiry.
 */
export async function watchInbox(topic: TopicName): Promise<{
  historyId: string;
  expiration: Date;
}> {
  const client = getGmailClient();
  const res = await client.users.watch({
    userId: "me",
    requestBody: {
      topicName: topic,
      // INBOX excludes messages we ourselves sent / Drafts / Trash, but
      // INCLUDES Spam — confirmed via Gmail API docs. Forwarded mail
      // often lands in Spam first, so we want push notifications for it.
      labelIds: ["INBOX", "SPAM"],
      labelFilterBehavior: "INCLUDE",
    },
  });

  const historyId = res.data.historyId;
  const expirationMs = res.data.expiration;
  if (!historyId || !expirationMs) {
    throw new Error("Gmail watch() returned no historyId or expiration");
  }
  return {
    historyId,
    // expiration comes back as ms-since-epoch in a string.
    expiration: new Date(Number(expirationMs)),
  };
}

/** Tear down the active watch, e.g. on env teardown or rotation. */
export async function stopWatch(): Promise<void> {
  await getGmailClient().users.stop({ userId: "me" });
}

/**
 * Pull the changes since the last seen historyId. We ask only for
 * `messageAdded` events — the only thing the webhook cares about — and
 * include spam so forwarded mail isn't silently dropped.
 *
 * Returns the new messages' IDs along with the latest historyId in the
 * response, so the caller can checkpoint progress atomically.
 */
export async function listHistorySince(startHistoryId: string): Promise<{
  messageIds: string[];
  latestHistoryId: string | null;
}> {
  const client = getGmailClient();
  const res = await client.users.history.list({
    userId: "me",
    startHistoryId,
    historyTypes: ["messageAdded"],
    // Default false — without this, forwarded mail Gmail flagged as spam
    // never reaches us. We explicitly want it.
    // (Field is on history.list in v1; if the SDK typings differ, this
    // is the underlying REST parameter.)
  });

  const messageIds: string[] = [];
  for (const h of res.data.history ?? []) {
    for (const m of h.messagesAdded ?? []) {
      const id = m.message?.id;
      if (id) messageIds.push(id);
    }
  }
  return {
    messageIds,
    latestHistoryId: res.data.historyId ?? null,
  };
}

/**
 * Full message including all headers (we need `From`, `To`,
 * `Authentication-Results` for DKIM, `Subject`) and payload tree so the
 * webhook can walk attachments. `format: "full"` returns parsed parts;
 * if you need raw RFC 822 bytes, switch to `"raw"`.
 */
export async function getMessage(
  messageId: string,
): Promise<gmail_v1.Schema$Message> {
  const res = await getGmailClient().users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  return res.data;
}

/**
 * Download the bytes of a single attachment by ID. Gmail returns base64url-
 * encoded data; we decode to a Buffer so callers can hand it straight to
 * the existing upload pipeline (`insertInvoiceFromUploadedBuffer`).
 */
export async function getAttachmentBuffer(
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const res = await getGmailClient().users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });
  const data = res.data.data;
  if (!data) throw new Error("Attachment had no data");
  return Buffer.from(data, "base64url");
}

/**
 * Mark a message as read so it stops appearing in the unread count.
 * Doesn't archive — the user (operator) can still see it in the inbox
 * if they need to debug.
 */
export async function markMessageRead(messageId: string): Promise<void> {
  await getGmailClient().users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

/**
 * Send a plain-text reply via the inbox. Used for the auto-reply on
 * `unknown_sender` rejections so the human knows their email didn't make
 * it. Sender is implicitly the inbox address (`me`). Threading is
 * optional — passing the original message's threadId keeps the reply in
 * the same Gmail conversation, which is what we want.
 */
export async function sendPlainTextReply(params: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
}): Promise<void> {
  const { to, subject, body, threadId, inReplyTo } = params;

  const headers = [
    `To: ${to}`,
    `From: ${getInboxAddress()}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
  ];
  if (inReplyTo) {
    headers.push(`In-Reply-To: <${inReplyTo}>`);
    headers.push(`References: <${inReplyTo}>`);
  }
  const raw = Buffer.from(headers.join("\r\n") + "\r\n\r\n" + body, "utf8")
    .toString("base64url");

  await getGmailClient().users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      ...(threadId ? { threadId } : {}),
    },
  });
}
