/**
 * Manual verification harness for Spec 01 document numbering, rescoped
 * to business entities per Spec 03.
 *
 * Run: `npx tsx scripts/verify-numbering.ts`
 * Requires: DATABASE_URL pointing at a DB where migrations 0022 + 0024
 * have been applied. Creates disposable users + business entities and
 * cleans up after itself.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

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

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 12 });

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const badge = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${badge}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function formatDocumentNumber(
  prefix: string,
  taxYear: number,
  sequenceNumber: number,
): string {
  return `${taxYear}-${prefix}-${String(sequenceNumber).padStart(6, "0")}`;
}

async function allocate(
  tx: postgres.TransactionSql,
  businessEntityId: string,
  userId: string,
  documentType: string,
  taxYear: number,
): Promise<number> {
  const rows = await tx<{ current_number: string | number }[]>`
    INSERT INTO document_number_sequences
      (business_entity_id, user_id, document_type, tax_year, current_number, updated_at)
    VALUES (${businessEntityId}, ${userId}, ${documentType}, ${taxYear}, 1, NOW())
    ON CONFLICT (business_entity_id, document_type, tax_year)
    DO UPDATE SET
      current_number = document_number_sequences.current_number + 1,
      updated_at = NOW()
    RETURNING current_number
  `;
  return Number(rows[0].current_number);
}

interface Fixture {
  userId: string;
  businessEntityId: string;
}

async function mkFixture(tag: string): Promise<Fixture> {
  const email = `verify-numbering-${tag}-${randomUUID()}@test.local`;
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email) VALUES (${email}) RETURNING id
  `;
  const [entity] = await sql<{ id: string }[]>`
    INSERT INTO business_entities (owner_user_id, legal_name, entity_type)
    VALUES (${user.id}, ${"verify-" + tag}, 'OSEK_MURSHE')
    RETURNING id
  `;
  return { userId: user.id, businessEntityId: entity.id };
}

async function cleanup(f: Fixture) {
  await sql`DELETE FROM document_number_sequences WHERE business_entity_id = ${f.businessEntityId}`;
  await sql`DELETE FROM business_entities WHERE id = ${f.businessEntityId}`;
  await sql`DELETE FROM users WHERE id = ${f.userId}`;
}

// --- Scenario 1: concurrency ------------------------------------------------

async function scenarioConcurrency() {
  const name = "1. concurrency — 10 parallel allocations yield 1..10 exactly";
  const f = await mkFixture("conc");
  try {
    const allocated = await Promise.all(
      Array.from({ length: 10 }, () =>
        sql.begin(async (tx) =>
          allocate(tx, f.businessEntityId, f.userId, "TAX_INVOICE", 2026),
        ),
      ),
    );
    const sorted = [...allocated].sort((a, b) => a - b);
    const expected = Array.from({ length: 10 }, (_, i) => i + 1);
    const ok =
      sorted.length === 10 && sorted.every((v, i) => v === expected[i]);
    record(name, ok, `got [${sorted.join(", ")}]`);
  } finally {
    await cleanup(f);
  }
}

// --- Scenario 2: gap prevention --------------------------------------------

async function scenarioGapPrevention() {
  const name = "2. gap prevention — failing tx does not consume a number";
  const f = await mkFixture("gap");
  try {
    const firstSeq = await sql.begin(async (tx) =>
      allocate(tx, f.businessEntityId, f.userId, "TAX_INVOICE", 2026),
    );
    try {
      await sql.begin(async (tx) => {
        await allocate(tx, f.businessEntityId, f.userId, "TAX_INVOICE", 2026);
        throw new Error("simulated downstream failure");
      });
    } catch {
      /* expected */
    }
    const nextSeq = await sql.begin(async (tx) =>
      allocate(tx, f.businessEntityId, f.userId, "TAX_INVOICE", 2026),
    );
    const ok = firstSeq === 1 && nextSeq === 2;
    record(name, ok, `first=${firstSeq}, afterRollback=${nextSeq}`);
  } finally {
    await cleanup(f);
  }
}

// --- Scenario 3: business-entity separation --------------------------------

async function scenarioEntitySeparation() {
  const name =
    "3. business-entity separation — A and B each start at 1 independently";
  const a = await mkFixture("entA");
  const b = await mkFixture("entB");
  try {
    const seqA = await sql.begin(async (tx) =>
      allocate(tx, a.businessEntityId, a.userId, "TAX_INVOICE", 2026),
    );
    const seqB = await sql.begin(async (tx) =>
      allocate(tx, b.businessEntityId, b.userId, "TAX_INVOICE", 2026),
    );
    record(name, seqA === 1 && seqB === 1, `A=${seqA}, B=${seqB}`);
  } finally {
    await cleanup(a);
    await cleanup(b);
  }
}

// --- Scenario 4: type separation -------------------------------------------

async function scenarioTypeSeparation() {
  const name = "4. type separation — TAX_INVOICE and RECEIPT each start at 1";
  const f = await mkFixture("types");
  try {
    const seqInv = await sql.begin(async (tx) =>
      allocate(tx, f.businessEntityId, f.userId, "TAX_INVOICE", 2026),
    );
    const seqRcpt = await sql.begin(async (tx) =>
      allocate(tx, f.businessEntityId, f.userId, "RECEIPT", 2026),
    );
    record(
      name,
      seqInv === 1 && seqRcpt === 1,
      `invoice=${seqInv}, receipt=${seqRcpt}`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- Scenario 5: year rollover ---------------------------------------------

async function scenarioYearRollover() {
  const name = "5. year rollover — fresh year starts at 1 regardless of prior";
  const f = await mkFixture("years");
  try {
    for (let i = 0; i < 5; i++) {
      await sql.begin(async (tx) =>
        allocate(tx, f.businessEntityId, f.userId, "TAX_INVOICE", 2026),
      );
    }
    const seq2027 = await sql.begin(async (tx) =>
      allocate(tx, f.businessEntityId, f.userId, "TAX_INVOICE", 2027),
    );
    record(name, seq2027 === 1, `2027 first seq=${seq2027}`);
  } finally {
    await cleanup(f);
  }
}

// --- Scenario 6: format determinism ----------------------------------------

async function scenarioFormat() {
  const name = "6. format — (TAX_INVOICE, 2026, 42) → '2026-TI-000042'";
  const got = formatDocumentNumber("TI", 2026, 42);
  record(name, got === "2026-TI-000042", got);
}

// --- Scenario 7: high-volume sequence overflow -----------------------------

async function scenarioHighVolume() {
  // Spec 11 edge case: verify that a seven-digit sequence number
  // renders as ${taxYear}-${prefix}-${n} without breaking the
  // zero-pad invariant (i.e. widths are min-6, not exactly-6).
  const name =
    "7. high-volume — sequence 1000001 renders as 2026-TI-1000001 (7 digits)";
  const got = formatDocumentNumber("TI", 2026, 1_000_001);
  const ok = got === "2026-TI-1000001";
  record(name, ok, got);
}

// --- Runner -----------------------------------------------------------------

async function main() {
  console.log("[verify-numbering] starting…\n");
  const scenarios: Array<[string, () => Promise<void>]> = [
    ["concurrency", scenarioConcurrency],
    ["gapPrevention", scenarioGapPrevention],
    ["entitySeparation", scenarioEntitySeparation],
    ["typeSeparation", scenarioTypeSeparation],
    ["yearRollover", scenarioYearRollover],
    ["format", scenarioFormat],
    ["highVolume", scenarioHighVolume],
  ];
  for (const [label, fn] of scenarios) {
    try {
      await fn();
    } catch (err) {
      record(label, false, err instanceof Error ? err.message : String(err));
    }
  }
  await sql.end({ timeout: 10 });
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n[verify-numbering] ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-numbering] fatal:", err);
  process.exit(1);
});
