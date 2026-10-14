#!/usr/bin/env node
/**
 * Convenience launcher: runs scripts/gmail-watch-register.ts via tsx so
 * you don't have to remember the command. The actual logic lives in
 * the .ts file (so it can `import` from src/lib/gmail).
 *
 * Usage:
 *   node scripts/gmail-watch-register.mjs
 *
 * Required env (load .env yourself, or prefix the call):
 *   GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET,
 *   GMAIL_OAUTH_REFRESH_TOKEN, GMAIL_INBOX_ADDRESS,
 *   GMAIL_PUBSUB_TOPIC (projects/<gcp-project>/topics/<name>),
 *   DATABASE_URL.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tsFile = join(here, "gmail-watch-register.ts");

const child = spawn("npx", ["tsx", tsFile], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
