/**
 * Manual verification harness for Spec 02 audit log + hash chain, rescoped
 * per Spec 03 to business entities.
 *
 * Run: `npx tsx scripts/verify-audit.ts`
 * Requires: DATABASE_URL pointing at a DB where migrations 0022 + 0023 +
 * 0024 have been applied. Creates disposable users + business entities
 * and cleans up.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { appendAuditEntry } from "@/lib/audit/append";
import { verifyChain } from "@/lib/audit/verify-chain";
import { diffFields } from "@/lib/audit/helpers";

function loadEnvFile() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env */
  }
}

loadEnvFile();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL, { max: 25 });
const db = drizzle(client, { schema });

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const badge = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${badge}  ${name}${detail ? ` — ${detail}` : ""}`);
}

interface Fixture {
  userId: string;
  businessEntityId: string;
}

async function mkFixture(tag: string): Promise<Fixture> {
  const email = `verify-audit-${tag}-${randomUUID()}@test.local`;
  const [user] = await client<{ id: string }[]>`
    INSERT INTO users (email) VALUES (${email}) RETURNING id
  `;
  const [entity] = await client<{ id: string }[]>`
    INSERT INTO business_entities (owner_user_id, legal_name, entity_type)
    VALUES (${user.id}, ${"verify-" + tag}, 'OSEK_MURSHE')
    RETURNING id
  `;
  return { userId: user.id, businessEntityId: entity.id };
}

async function cleanup(f: Fixture) {
  await client`DELETE FROM document_audit_log WHERE business_entity_id = ${f.businessEntityId}`;
  await client`DELETE FROM business_entities WHERE id = ${f.businessEntityId}`;
  await client`DELETE FROM users WHERE id = ${f.userId}`;
}

// --- 1. chain integrity -----------------------------------------------------

async function scenarioChainIntegrity() {
  const name = "1. chain integrity — 100 entries, verifyChain ok";
  const f = await mkFixture("integ");
  try {
    for (let i = 1; i <= 100; i++) {
      await appendAuditEntry({
        businessEntityId: f.businessEntityId,
        userId: f.userId,
        documentId: randomUUID(),
        documentType: "TAX_INVOICE",
        eventType: "CREATED",
        eventPayload: { index: i },
        actor: { userId: f.userId },
      });
    }
    const result = await verifyChain(f.businessEntityId);
    record(
      name,
      result.ok === true,
      result.ok
        ? `entriesChecked=${result.entriesChecked}`
        : `broken at ${result.brokenAt} (${result.reason})`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 2. chain tampering -----------------------------------------------------

async function scenarioChainTampering() {
  const name = "2. chain tampering — mutate entry 5 payload, expect broken";
  const f = await mkFixture("tamper");
  try {
    for (let i = 1; i <= 10; i++) {
      await appendAuditEntry({
        businessEntityId: f.businessEntityId,
        userId: f.userId,
        documentId: randomUUID(),
        documentType: "TAX_INVOICE",
        eventType: "CREATED",
        eventPayload: { index: i },
        actor: { userId: f.userId },
      });
    }
    await client`
      UPDATE document_audit_log
      SET event_payload = '{"index": 9999}'::jsonb
      WHERE business_entity_id = ${f.businessEntityId} AND sequence_number = 5
    `;
    const result = await verifyChain(f.businessEntityId);
    record(
      name,
      result.ok === false && result.brokenAt === 5,
      result.ok === false
        ? `broken at ${result.brokenAt} (${result.reason})`
        : "unexpectedly verified",
    );
  } finally {
    await cleanup(f);
  }
}

// --- 3. concurrency ---------------------------------------------------------

async function scenarioConcurrency() {
  const name = "3. concurrency — 20 parallel appends → seq 1..20, chain ok";
  const f = await mkFixture("conc");
  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        appendAuditEntry({
          businessEntityId: f.businessEntityId,
          userId: f.userId,
          documentId: randomUUID(),
          documentType: "TAX_INVOICE",
          eventType: "CREATED",
          eventPayload: { parallel: i },
          actor: { userId: f.userId },
        }),
      ),
    );
    const seqs = results.map((r) => r.sequenceNumber).sort((a, b) => a - b);
    const expected = Array.from({ length: 20 }, (_, i) => i + 1);
    const seqsOk = seqs.every((v, i) => v === expected[i]);
    const chain = await verifyChain(f.businessEntityId);
    const ok = seqsOk && chain.ok === true;
    record(
      name,
      ok,
      `seqs=[${seqs.slice(0, 5).join(",")}..${seqs.slice(-3).join(",")}], chain=${
        chain.ok ? "ok" : "broken"
      }`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 5. transaction rollback ------------------------------------------------

async function scenarioRollback() {
  const name =
    "4. transaction rollback — rolled-back append leaves no trace";
  const f = await mkFixture("rollback");
  try {
    const first = await appendAuditEntry({
      businessEntityId: f.businessEntityId,
      userId: f.userId,
      documentId: randomUUID(),
      documentType: "TAX_INVOICE",
      eventType: "CREATED",
      eventPayload: { note: "real" },
      actor: { userId: f.userId },
    });

    try {
      await db.transaction(async (tx) => {
        await appendAuditEntry({
          tx,
          businessEntityId: f.businessEntityId,
          userId: f.userId,
          documentId: randomUUID(),
          documentType: "TAX_INVOICE",
          eventType: "UPDATED",
          eventPayload: { note: "ghost" },
          actor: { userId: f.userId },
        });
        throw new Error("rollback");
      });
    } catch {
      /* expected */
    }

    const second = await appendAuditEntry({
      businessEntityId: f.businessEntityId,
      userId: f.userId,
      documentId: randomUUID(),
      documentType: "TAX_INVOICE",
      eventType: "UPDATED",
      eventPayload: { note: "real again" },
      actor: { userId: f.userId },
    });
    const chain = await verifyChain(f.businessEntityId);
    const ok =
      first.sequenceNumber === 1 &&
      second.sequenceNumber === 2 &&
      chain.ok === true;
    record(
      name,
      ok,
      `first=${first.sequenceNumber}, after-rollback=${second.sequenceNumber}, chain=${chain.ok ? "ok" : "broken"}`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 5. diffFields pure test -----------------------------------------------

async function scenarioDiffFields() {
  const name = "5. diffFields — emits only changed keys, normalises dates";
  const before = { a: 1, b: "x", c: new Date("2026-01-01T00:00:00Z"), d: 7 };
  const after = { a: 1, b: "y", c: new Date("2026-01-01T00:00:00Z"), d: 8 };
  const diff = diffFields(
    before as Record<string, unknown>,
    after as Record<string, unknown>,
  );
  const keys = Object.keys(diff).sort();
  const ok =
    keys.join(",") === "b,d" &&
    diff.b?.from === "x" &&
    diff.b?.to === "y" &&
    diff.d?.from === 7 &&
    diff.d?.to === 8;
  record(name, ok, `keys=[${keys.join(",")}]`);
}

async function main() {
  await db.execute(dsql`SELECT 1`);
  console.log("[verify-audit] starting…\n");

  const scenarios: Array<[string, () => Promise<void>]> = [
    ["chainIntegrity", scenarioChainIntegrity],
    ["chainTampering", scenarioChainTampering],
    ["concurrency", scenarioConcurrency],
    ["rollback", scenarioRollback],
    ["diffFields", scenarioDiffFields],
  ];
  for (const [label, fn] of scenarios) {
    try {
      await fn();
    } catch (err) {
      record(label, false, err instanceof Error ? err.message : String(err));
    }
  }

  await client.end({ timeout: 10 });
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n[verify-audit] ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-audit] fatal:", err);
  process.exit(1);
});
