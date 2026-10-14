#!/usr/bin/env node
/**
 * One-shot helper: runs Google's OAuth consent flow locally against a
 * Desktop-type OAuth client and prints the refresh token for the Gmail
 * invoice-intake mailbox — the address in GMAIL_INTAKE_ADDRESS.
 *
 * Paste the printed value into .env as GMAIL_OAUTH_REFRESH_TOKEN.
 *
 * Usage:
 *   GMAIL_OAUTH_CLIENT_ID=...apps.googleusercontent.com \
 *   GMAIL_OAUTH_CLIENT_SECRET=... \
 *   node scripts/gmail-auth.mjs
 *
 * Requires Node 18+ (uses global fetch). No external dependencies.
 */

import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { spawn } from "node:child_process";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Missing env vars. Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET before running.",
  );
  process.exit(1);
}

// Desktop-type OAuth clients accept any http://localhost:<port> redirect
// without it having to be registered in the GCP console. Pick a fixed high
// port so the user can see it in their terminal if the browser doesn't
// auto-open.
const port = 53682;
const redirectUri = `http://localhost:${port}`;
const state = crypto.randomBytes(16).toString("hex");

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
// access_type=offline + prompt=consent is what forces Google to return a
// refresh_token. Without this you only get an access_token (1h lifetime).
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");
authUrl.searchParams.set("scope", SCOPES.join(" "));
authUrl.searchParams.set("state", state);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  const code = url.searchParams.get("code");
  const gotState = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end(`OAuth error: ${errorParam}. Check your terminal.`);
    console.error(`\n❌ Google returned error=${errorParam}`);
    server.close();
    process.exit(1);
    return;
  }

  if (!code) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("No code in callback.");
    return;
  }
  if (gotState !== state) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("State mismatch — possible CSRF, aborting.");
    server.close();
    process.exit(1);
    return;
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();

    if (!tokenRes.ok || !tokens.refresh_token) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Token exchange failed — check your terminal.");
      console.error("\n❌ Token exchange failed:", tokens);
      if (tokenRes.ok && !tokens.refresh_token) {
        console.error(
          "\nGoogle returned no refresh_token. This usually means you already\n" +
            "consented with this client before. Revoke the app at\n" +
            "https://myaccount.google.com/permissions and re-run this script.",
        );
      }
      server.close();
      process.exit(1);
      return;
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      "<!doctype html><meta charset=utf-8><title>Done</title>" +
        "<body style=font-family:system-ui;padding:2rem>" +
        "<h2>Done.</h2>" +
        "<p>Refresh token printed to your terminal. You can close this tab.</p>",
    );

    console.log("\n=====================================================");
    console.log("✅ Refresh token (paste into .env):");
    console.log("\nGMAIL_OAUTH_REFRESH_TOKEN=" + tokens.refresh_token);
    console.log("=====================================================\n");

    server.close();
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Unexpected error:", err);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Error exchanging code — check your terminal.");
    server.close();
    process.exit(1);
  }
});

server.listen(port, () => {
  console.log(`Listening on ${redirectUri}`);
  console.log("Opening browser for Google consent...\n");
  console.log(
    `If the browser doesn't open automatically, paste this URL:\n${authUrl.toString()}\n`,
  );

  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(opener, [authUrl.toString()], { stdio: "ignore", detached: true });
  } catch {
    // Headless environment — user will copy the URL manually.
  }
});
