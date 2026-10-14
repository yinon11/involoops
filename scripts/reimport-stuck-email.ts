/**
 * One-off: import a raw .eml (preserving original headers/DKIM) into the
 * intake Gmail mailbox, then run the normal processInboundMessage pipeline.
 *
 * Usage (on server, inside app container):
 *   npx tsx scripts/reimport-stuck-email.ts /path/to/message.eml
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { getGmailClient } from "@/lib/gmail/client";
import { processInboundMessage } from "@/lib/gmail/process-message";

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/reimport-stuck-email.ts <file.eml>");
    process.exit(1);
  }

  const raw = readFileSync(path);
  const client = getGmailClient();
  const imported = await client.users.messages.import({
    userId: "me",
    requestBody: {
      raw: raw.toString("base64url"),
      labelIds: ["INBOX"],
    },
  });

  const messageId = imported.data.id;
  if (!messageId) {
    throw new Error("Gmail import returned no message id");
  }

  console.log("imported gmail_message_id:", messageId);
  const result = await processInboundMessage(messageId);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
