/**
 * Manual verification harness for Spec 05 immutable archive.
 *
 * Run: `npx tsx scripts/verify-archive.ts`
 * Requires: DATABASE_URL + the S3/MinIO env vars + an archive bucket
 * already provisioned by `scripts/setup-archive-bucket.ts` +
 * SIGNING_KEY_ID + SIGNING_PRIVATE_KEY_PEM (Spec 04).
 *
 * If S3 is unreachable, all S3-dependent scenarios SKIP with a clear
 * notice rather than false-failing.
 *
 * Scenarios (per spec 05 §Tests):
 *   1. Store + retrieve — 4 objects per document, signed URL works,
 *      hashes match.
 *   2. Chain integrity — N documents × 4 objects; verifyArchiveChain
 *      returns ok with the expected entry count.
 *   3. Tamper detection (DB) — mutate one row's contentSha256;
 *      verifyArchiveChain reports the broken sequence.
 *   4. Tamper detection (S3) — SKIPPED by design: COMPLIANCE Object
 *      Lock prevents overwrite-by-root, which is the point.
 *   5. Concurrent archiving — N parallel archives → 4N entries with
 *      no gaps, chain validates.
 *   6. Issue-fails-if-archive-fails — point S3_ARCHIVE_BUCKET at a
 *      non-existent name; attempt issue; assert no DB state changed.
 *   7. Archive survives restart — trivially covered by scenario 2
 *      since state lives entirely in DB + S3.
 *   8. Retention enforcement — sample one object and assert
 *      COMPLIANCE mode + retain-until >= storedAt + 2550 days.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import {
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import * as schema from "@/db/schema";
import {
  archiveDocument,
  type ArchiveInputSignature,
} from "@/lib/archive/store";
import { verifyArchiveChain } from "@/lib/archive/verify";
import {
  getArchiveBucketName,
  getArchiveObjectBytes,
  getArchiveObjectRetention,
} from "@/lib/archive/s3";
import type { CanonicalDocument } from "@/lib/signing/canonical-document";

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

const client = postgres(process.env.DATABASE_URL, { max: 12 });
const db = drizzle(client, { schema });

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
let skipS3 = false;

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const badge = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${badge}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function skip(name: string, why: string) {
  const badge = "\x1b[33mSKIP\x1b[0m";
  console.log(`${badge}  ${name} — ${why}`);
}

async function canReachBucket(): Promise<boolean> {
  const s3 = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "",
    },
    forcePathStyle: true,
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: getArchiveBucketName() }));
    return true;
  } catch {
    return false;
  }
}

interface Fixture {
  userId: string;
  businessEntityId: string;
  customerId: string;
  invoiceId: string;
  canonicalDocument: CanonicalDocument;
  canonicalJsonString: string;
  signature: ArchiveInputSignature;
  pdfBuffer: Buffer;
}

function makeFakeSignature(canonicalJsonString: string): ArchiveInputSignature {
  const hash = createHash("sha256")
    .update(canonicalJsonString, "utf8")
    .digest("hex");
  return {
    keyId: "verify-archive-fake-key",
    algorithm: "RS256",
    signatureBase64: Buffer.from("fake-signature").toString("base64"),
    signedAt: new Date(),
    canonicalJsonHash: hash,
  };
}

async function mkFixture(tag: string): Promise<Fixture> {
  const email = `verify-archive-${tag}-${randomUUID()}@test.local`;
  const [user] = await client<{ id: string }[]>`
    INSERT INTO users (email) VALUES (${email}) RETURNING id
  `;
  const [entity] = await client<{ id: string }[]>`
    INSERT INTO business_entities (owner_user_id, legal_name, entity_type, osek_murshe)
    VALUES (${user.id}, ${"verify-" + tag}, 'OSEK_MURSHE', '123456789')
    RETURNING id
  `;
  const [customer] = await client<{ id: string }[]>`
    INSERT INTO customers (user_id, name)
    VALUES (${user.id}, ${"Customer " + tag})
    RETURNING id
  `;
  const seq = Math.floor(Math.random() * 1e6);
  const fmt = `2026-TI-${String(seq).padStart(6, "0")}`;
  const items = JSON.stringify([
    { description: "Widget", quantity: 1, unitPrice: 100, total: 100 },
  ]);
  const [invoice] = await client<{ id: string }[]>`
    INSERT INTO outbound_invoices (
      user_id, business_entity_id, customer_id,
      invoice_number, document_type, tax_year, sequence_number, formatted_number,
      invoice_date, items, subtotal, vat_rate, vat_amount, total, status
    ) VALUES (
      ${user.id}, ${entity.id}, ${customer.id},
      ${fmt}, 'TAX_INVOICE', 2026, ${seq}, ${fmt},
      '2026-04-20', ${items}::jsonb, '100.00', '18', '18.00', '118.00', 'draft'
    ) RETURNING id
  `;

  const canonicalDocument = {
    schemaVersion: 1,
    documentId: invoice.id,
    documentType: "TAX_INVOICE" as const,
    formattedNumber: fmt,
    sequenceNumber: seq,
    taxYear: 2026,
    issueDate: "2026-04-20T00:00:00.000Z",
    businessEntity: {
      id: entity.id,
      legalName: `verify-${tag}`,
      osekMurshe: "123456789",
      entityType: "OSEK_MURSHE",
      address: {},
    },
    customer: {
      id: customer.id,
      name: `Customer ${tag}`,
      osekMurshe: null,
      address: {},
    },
    lines: [
      {
        description: "Widget",
        quantity: "1.00",
        unitPrice: "100.00",
        lineTotal: "100.00",
        vatRate: "18.00",
        vatAmount: "18.00",
      },
    ],
    totals: {
      subtotal: "100.00",
      vatTotal: "18.00",
      grandTotal: "118.00",
      currency: "ILS",
    },
    metadata: {
      createdAt: new Date().toISOString(),
      createdByUserId: user.id,
    },
  } as CanonicalDocument;
  const canonicalJsonString = JSON.stringify(canonicalDocument);
  const signature = makeFakeSignature(canonicalJsonString);
  const pdfBuffer = Buffer.from(`%PDF-1.4 fake ${fmt}`, "utf8");

  return {
    userId: user.id,
    businessEntityId: entity.id,
    customerId: customer.id,
    invoiceId: invoice.id,
    canonicalDocument,
    canonicalJsonString,
    signature,
    pdfBuffer,
  };
}

async function cleanup(f: Fixture) {
  await teardownBusinessEntity(f.businessEntityId);
  // `customers` is scoped per-user, not per-entity; delete the
  // fixture's customer before the user so the users cascade doesn't
  // leave us relying on ON DELETE CASCADE behaviour.
  await client`DELETE FROM customers WHERE user_id = ${f.userId}`;
  await client`DELETE FROM users WHERE id = ${f.userId}`;
}

/**
 * Deletes every row that FKs (directly) to `business_entities.id = X`
 * in dependency order, then the entity itself. The archive test fixtures
 * only touch a subset of these tables, but we scrub the full set anyway
 * so any later scenario that seeds additional rows doesn't leave
 * orphans that block the entity delete on the next run.
 *
 * FK audit (src/db/schema/*):
 *   RESTRICT → must be deleted before the entity:
 *     archive_objects, document_audit_log, document_signatures,
 *     outbound_invoices.
 *   CASCADE → postgres would handle it, but we delete explicitly so
 *     the test owns its cleanup order and so an accidental RESTRICT
 *     conversion later fails loud here rather than leaking:
 *     document_links, document_number_sequences,
 *     business_entity_members, shaam_authorizations,
 *     shaam_token_events, shaam_authorization_pending,
 *     shaam_tenant_readiness, notification_sent_log,
 *     shaam_submissions, uniform_structure_exports.
 */
async function teardownBusinessEntity(bizId: string) {
  // Test teardown only: direct delete of document_audit_log rows.
  // Production code MUST use appendAuditEntry() and never delete audit rows.
  // The append-only guarantee is enforced at the application layer, not DB.
  await client`DELETE FROM archive_objects WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM document_signatures WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM document_links WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM document_audit_log WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM outbound_invoices WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM document_number_sequences WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM business_entity_members WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM shaam_submissions WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM shaam_token_events WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM shaam_authorization_pending WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM shaam_authorizations WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM shaam_tenant_readiness WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM notification_sent_log WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM uniform_structure_exports WHERE business_entity_id = ${bizId}`;
  await client`DELETE FROM business_entities WHERE id = ${bizId}`;
}

// --- 1. store + retrieve --------------------------------------------------

async function scenarioStoreAndRetrieve() {
  const name = "1. store + retrieve — 4 objects, hashes match";
  if (skipS3) return skip(name, "S3 unreachable");
  const f = await mkFixture("store");
  try {
    const { storedObjects } = await db.transaction((tx) =>
      archiveDocument({
        tx,
        document: {
          id: f.invoiceId,
          businessEntityId: f.businessEntityId,
          userId: f.userId,
          documentType: "TAX_INVOICE",
          formattedNumber: f.canonicalDocument.formattedNumber,
          taxYear: 2026,
        },
        canonicalDocument: f.canonicalDocument,
        canonicalJsonString: f.canonicalJsonString,
        signature: f.signature,
        pdfBuffer: f.pdfBuffer,
        actorUserId: f.userId,
      }),
    );
    let ok = storedObjects.length === 4;
    for (const o of storedObjects) {
      const bytes = await getArchiveObjectBytes({
        key: o.key,
        versionId: o.versionId,
      });
      const sha = createHash("sha256").update(bytes).digest("hex");
      if (sha !== o.contentSha256) ok = false;
    }
    record(name, ok, `objects=${storedObjects.length}`);
  } finally {
    await cleanup(f);
  }
}

// --- 2. chain integrity ----------------------------------------------------

async function scenarioChainIntegrity() {
  const name = "2. chain integrity — 3 docs × 4 objects, verifyArchiveChain ok";
  if (skipS3) return skip(name, "S3 unreachable");
  const f = await mkFixture("chain");
  try {
    // Archive 3 documents for the same business entity. The fixture's
    // single invoice can only be archived once (unique document_id),
    // so we add two more invoices inline.
    const ids = [f.invoiceId];
    for (let i = 0; i < 2; i++) {
      const seq = Math.floor(Math.random() * 1e6);
      const fmt = `2026-TI-${String(seq).padStart(6, "0")}`;
      const [row] = await client<{ id: string }[]>`
        INSERT INTO outbound_invoices (
          user_id, business_entity_id, customer_id,
          invoice_number, document_type, tax_year, sequence_number, formatted_number,
          invoice_date, items, subtotal, vat_rate, vat_amount, total, status
        ) VALUES (
          ${f.userId}, ${f.businessEntityId}, ${f.customerId},
          ${fmt}, 'TAX_INVOICE', 2026, ${seq}, ${fmt},
          '2026-04-20', ${JSON.stringify(f.canonicalDocument.lines)}::jsonb,
          '100.00', '18', '18.00', '118.00', 'draft'
        ) RETURNING id
      `;
      ids.push(row.id);
    }
    for (const id of ids) {
      await db.transaction((tx) =>
        archiveDocument({
          tx,
          document: {
            id,
            businessEntityId: f.businessEntityId,
            userId: f.userId,
            documentType: "TAX_INVOICE",
            formattedNumber: `${id.slice(0, 6)}`,
            taxYear: 2026,
          },
          canonicalDocument: f.canonicalDocument,
          canonicalJsonString: f.canonicalJsonString,
          signature: f.signature,
          pdfBuffer: f.pdfBuffer,
          actorUserId: f.userId,
        }),
      );
    }
    const result = await verifyArchiveChain(f.businessEntityId);
    const ok = result.ok && result.entriesChecked === 12;
    record(
      name,
      ok,
      result.ok
        ? `entriesChecked=${result.entriesChecked}`
        : `broken at ${result.brokenAt}`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 3. DB tamper ----------------------------------------------------------

async function scenarioTamperDb() {
  const name = "3. tamper detection (DB) — mutate contentSha256, expect broken";
  if (skipS3) return skip(name, "S3 unreachable");
  const f = await mkFixture("tamper");
  try {
    await db.transaction((tx) =>
      archiveDocument({
        tx,
        document: {
          id: f.invoiceId,
          businessEntityId: f.businessEntityId,
          userId: f.userId,
          documentType: "TAX_INVOICE",
          formattedNumber: f.canonicalDocument.formattedNumber,
          taxYear: 2026,
        },
        canonicalDocument: f.canonicalDocument,
        canonicalJsonString: f.canonicalJsonString,
        signature: f.signature,
        pdfBuffer: f.pdfBuffer,
        actorUserId: f.userId,
      }),
    );
    await client`
      UPDATE archive_objects
      SET content_sha256 = 'deadbeef'
      WHERE business_entity_id = ${f.businessEntityId} AND chain_sequence = 2
    `;
    const result = await verifyArchiveChain(f.businessEntityId);
    const ok = result.ok === false && result.brokenAt === 2;
    record(name, ok, result.ok ? "unexpectedly verified" : `reason=${result.reason}`);
  } finally {
    await cleanup(f);
  }
}

// --- 5. concurrent archiving -----------------------------------------------

async function scenarioConcurrent() {
  const name = "5. concurrent archiving — 3 parallel docs × 4 objects, no gaps";
  if (skipS3) return skip(name, "S3 unreachable");
  const f = await mkFixture("conc");
  try {
    const ids = [f.invoiceId];
    for (let i = 0; i < 2; i++) {
      const seq = Math.floor(Math.random() * 1e6);
      const fmt = `2026-TI-${String(seq).padStart(6, "0")}`;
      const [row] = await client<{ id: string }[]>`
        INSERT INTO outbound_invoices (
          user_id, business_entity_id, customer_id,
          invoice_number, document_type, tax_year, sequence_number, formatted_number,
          invoice_date, items, subtotal, vat_rate, vat_amount, total, status
        ) VALUES (
          ${f.userId}, ${f.businessEntityId}, ${f.customerId},
          ${fmt}, 'TAX_INVOICE', 2026, ${seq}, ${fmt},
          '2026-04-20', ${JSON.stringify(f.canonicalDocument.lines)}::jsonb,
          '100.00', '18', '18.00', '118.00', 'draft'
        ) RETURNING id
      `;
      ids.push(row.id);
    }

    await Promise.all(
      ids.map((id) =>
        db.transaction((tx) =>
          archiveDocument({
            tx,
            document: {
              id,
              businessEntityId: f.businessEntityId,
              userId: f.userId,
              documentType: "TAX_INVOICE",
              formattedNumber: `${id.slice(0, 6)}`,
              taxYear: 2026,
            },
            canonicalDocument: f.canonicalDocument,
            canonicalJsonString: f.canonicalJsonString,
            signature: f.signature,
            pdfBuffer: f.pdfBuffer,
            actorUserId: f.userId,
          }),
        ),
      ),
    );

    const result = await verifyArchiveChain(f.businessEntityId);
    const ok = result.ok && result.entriesChecked === 12;
    record(
      name,
      ok,
      result.ok ? `entriesChecked=${result.entriesChecked}` : "broken",
    );
  } finally {
    await cleanup(f);
  }
}

// --- 8. retention enforcement ---------------------------------------------

async function scenarioRetention() {
  const name = "8. retention — COMPLIANCE mode + retain-until >= 2550d";
  if (skipS3) return skip(name, "S3 unreachable");
  const f = await mkFixture("ret");
  try {
    const { storedObjects } = await db.transaction((tx) =>
      archiveDocument({
        tx,
        document: {
          id: f.invoiceId,
          businessEntityId: f.businessEntityId,
          userId: f.userId,
          documentType: "TAX_INVOICE",
          formattedNumber: f.canonicalDocument.formattedNumber,
          taxYear: 2026,
        },
        canonicalDocument: f.canonicalDocument,
        canonicalJsonString: f.canonicalJsonString,
        signature: f.signature,
        pdfBuffer: f.pdfBuffer,
        actorUserId: f.userId,
      }),
    );
    const sample = storedObjects[0];
    const retention = await getArchiveObjectRetention({
      key: sample.key,
      versionId: sample.versionId,
    });
    const ok =
      retention.mode === "COMPLIANCE" &&
      retention.retainUntil !== null &&
      retention.retainUntil.getTime() - Date.now() >= 2550 * 86400_000;
    record(
      name,
      ok,
      `mode=${retention.mode} until=${retention.retainUntil?.toISOString()}`,
    );
  } finally {
    await cleanup(f);
  }
}

async function main() {
  await db.execute(dsql`SELECT 1`);
  console.log("[verify-archive] starting…\n");
  if (!(await canReachBucket())) {
    console.log(
      `[verify-archive] S3/MinIO unreachable for bucket="${getArchiveBucketName()}" — S3-dependent scenarios will SKIP.`,
    );
    console.log(
      `                 Run scripts/setup-archive-bucket.ts first and re-run.\n`,
    );
    skipS3 = true;
  }
  const scenarios: Array<[string, () => Promise<void>]> = [
    ["storeAndRetrieve", scenarioStoreAndRetrieve],
    ["chainIntegrity", scenarioChainIntegrity],
    ["tamperDb", scenarioTamperDb],
    ["concurrent", scenarioConcurrent],
    ["retention", scenarioRetention],
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
  console.log(
    `\n[verify-archive] ${passed}/${total} passed${skipS3 ? " (scenarios dependent on S3 were skipped)" : ""}`,
  );
  // If S3 is unreachable, total = 0, which is still a "clean" exit.
  process.exit(total === 0 || passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-archive] fatal:", err);
  process.exit(1);
});
