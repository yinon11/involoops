/**
 * Probe a user's stored BYOK Anthropic key against multiple models so we
 * can see exactly what Anthropic returns for the customer who's hitting
 * "model not found". Read-only: never writes to the DB and never logs the
 * plaintext key (only the last 4 chars, same as the UI hint).
 *
 * Usage (from inside the production app container):
 *   docker compose exec app npx tsx scripts/probe-byok.ts <emailOrUserId>
 *   # list everyone with a BYOK row:
 *   docker compose exec app npx tsx scripts/probe-byok.ts --list
 *
 * The script tries:
 *   1. The configured extraction model (Sonnet 4 by default)
 *   2. The configured segmentation model (Haiku 4.5 by default)
 *   3. claude-3-5-haiku-latest    (older Haiku family — sanity check)
 *   4. claude-3-5-sonnet-latest   (older Sonnet family — sanity check)
 *
 * For each it prints HTTP status, error type, and a one-line classification
 * (ok / unauthorized / model-not-found / rate-limited / other).
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, isNotNull, or } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import * as schema from "../src/db/schema";
import { users } from "../src/db/schema/users";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = postgres(connectionString, { max: 2 });
const db = drizzle(client, { schema });

const ALGO = "aes-256-gcm";
const HKDF_INFO = Buffer.from("invoices:user-anthropic-api-key:v1", "utf8");

function getEncryptionSecret(): string | null {
  const dedicated = process.env.USER_API_KEY_ENCRYPTION_SECRET?.trim();
  if (dedicated && dedicated.length > 0) return dedicated;
  const authSecret = process.env.AUTH_SECRET?.trim();
  if (authSecret && authSecret.length > 0) return authSecret;
  return null;
}

function deriveAesKey(): Buffer {
  const secret = getEncryptionSecret();
  if (!secret) throw new Error("Missing USER_API_KEY_ENCRYPTION_SECRET / AUTH_SECRET");
  const prk = crypto.createHash("sha256").update(secret).digest();
  const keyBytes = crypto.hkdfSync("sha256", prk, Buffer.alloc(0), HKDF_INFO, 32);
  return Buffer.from(keyBytes as ArrayBuffer);
}

function decryptKey(ciphertext: string, iv: string, tag: string): string {
  const key = deriveAesKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function classify(err: unknown): string {
  if (!err || typeof err !== "object") return "other";
  const e = err as { status?: unknown; message?: unknown; error?: { type?: unknown } };
  const status = typeof e.status === "number" ? e.status : null;
  const innerType =
    e.error && typeof e.error === "object"
      ? (e.error as { type?: unknown }).type
      : null;
  const msg = typeof e.message === "string" ? e.message : "";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404 || innerType === "not_found_error" || /not_found_error/.test(msg)) {
    return "model-not-found";
  }
  if (status === 429) return "rate-limited";
  return `http-${status ?? "?"}`;
}

async function probeModel(apiKey: string, model: string): Promise<{
  status: string;
  detail: string;
}> {
  try {
    const c = new Anthropic({ apiKey });
    await c.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { status: "ok", detail: "1-token response succeeded" };
  } catch (err) {
    const klass = classify(err);
    const msg = err instanceof Error ? err.message : String(err);
    const oneLine = msg.replace(/\s+/g, " ").slice(0, 220);
    return { status: klass, detail: oneLine };
  }
}

async function listByokUsers(): Promise<void> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      hint: users.anthropicApiKeyHint,
      validatedAt: users.anthropicApiKeyValidatedAt,
    })
    .from(users)
    .where(
      or(
        isNotNull(users.anthropicApiKeyCiphertext),
        isNotNull(users.anthropicApiKeyValidatedAt)
      )
    );
  if (rows.length === 0) {
    console.log("No users with BYOK key on file.");
    return;
  }
  console.log(`Found ${rows.length} BYOK user(s):`);
  for (const r of rows) {
    console.log(
      `  ${r.id}  ${r.email ?? "(no email)"}  hint=${r.hint ?? "?"}  validatedAt=${r.validatedAt?.toISOString() ?? "null"}`
    );
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg || arg === "--help" || arg === "-h") {
    console.log("Usage: probe-byok.ts <emailOrUserId>   |   probe-byok.ts --list");
    process.exit(arg ? 0 : 1);
  }
  if (arg === "--list") {
    await listByokUsers();
    await client.end({ timeout: 5 });
    return;
  }

  const row = await db.query.users.findFirst({
    where: arg.includes("@") ? eq(users.email, arg) : eq(users.id, arg),
    columns: {
      id: true,
      email: true,
      anthropicApiKeyCiphertext: true,
      anthropicApiKeyIv: true,
      anthropicApiKeyTag: true,
      anthropicApiKeyHint: true,
      anthropicApiKeyValidatedAt: true,
    },
  });

  if (!row) {
    console.error(`No user found for "${arg}"`);
    process.exit(2);
  }

  console.log(`User:        ${row.id}  ${row.email ?? "(no email)"}`);
  console.log(`Stored hint: ${row.anthropicApiKeyHint ?? "(none)"}`);
  console.log(`Validated:   ${row.anthropicApiKeyValidatedAt?.toISOString() ?? "null"}`);

  if (
    !row.anthropicApiKeyCiphertext ||
    !row.anthropicApiKeyIv ||
    !row.anthropicApiKeyTag
  ) {
    console.error("User has no encrypted key on file. Nothing to probe.");
    await client.end({ timeout: 5 });
    process.exit(3);
  }

  let apiKey: string;
  try {
    apiKey = decryptKey(
      row.anthropicApiKeyCiphertext,
      row.anthropicApiKeyIv,
      row.anthropicApiKeyTag
    );
  } catch (err) {
    console.error("Decryption failed (encryption secret rotated?):", err);
    await client.end({ timeout: 5 });
    process.exit(4);
  }

  const sanityHint = `...${apiKey.slice(-4)}`;
  console.log(`Decrypted hint matches stored hint? ${
    sanityHint === row.anthropicApiKeyHint ? "yes" : `NO (decrypted=${sanityHint})`
  }`);

  const extractionModel =
    process.env.ANTHROPIC_EXTRACTION_MODEL?.trim() || "claude-sonnet-4-6";
  const segmentationModel =
    process.env.ANTHROPIC_SEGMENTATION_MODEL?.trim() || "claude-haiku-4-5-20251001";

  const models = [
    { label: "extraction (Sonnet 4.6)", name: extractionModel },
    { label: "segmentation (Haiku 4.5)", name: segmentationModel },
    { label: "fallback Haiku 3.5", name: "claude-3-5-haiku-latest" },
    { label: "fallback Sonnet 3.5", name: "claude-3-5-sonnet-latest" },
  ];

  console.log("\nProbing models:");
  for (const m of models) {
    const r = await probeModel(apiKey, m.name);
    console.log(`  [${r.status.padEnd(16)}] ${m.label.padEnd(26)} ${m.name}`);
    if (r.status !== "ok") {
      console.log(`     -> ${r.detail}`);
    }
  }

  await client.end({ timeout: 5 });
}

main().catch((err) => {
  console.error("probe-byok failed:", err);
  client.end({ timeout: 5 }).finally(() => process.exit(99));
});
