/**
 * Run a Uniform Structure export synchronously (CLI / sandbox ops).
 *
 *   PERIOD_START=2026-01-01 PERIOD_END=2026-09-14 \
 *     npx tsx scripts/run-uniform-structure-export-cli.ts
 *
 * Sandbox container:
 *   docker compose -f docker-compose.sandbox.yml exec app \
 *     npx tsx scripts/run-uniform-structure-export-cli.ts
 */

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { businessEntities, uniformStructureExports, users } from "../src/db/schema";
import { runUniformStructureExport } from "../src/lib/uniform-structure/runner";
import { loadStoredRatesIntoMemory } from "../src/lib/fx/load-stored-rates";

function parseDateArg(name: string, fallback: string): string {
  const fromEnv = process.env[name]?.trim();
  const fromArgv = process.argv.find((a) => a.startsWith(`--${name.toLowerCase().replace(/_/g, "-")}=`));
  if (fromArgv) return fromArgv.split("=", 2)[1]!;
  return fromEnv ?? fallback;
}

async function main() {
  // Documents issued before rates were frozen convert at the latest stored
  // Bank of Israel rate; there is no fixed fallback.
  await loadStoredRatesIntoMemory();
  const periodStart = parseDateArg("PERIOD_START", "2026-01-01");
  const periodEnd = parseDateArg("PERIOD_END", new Date().toISOString().slice(0, 10));

  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T23:59:59Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    console.error("Invalid period:", periodStart, periodEnd);
    process.exit(1);
  }

  let businessEntityId = process.env.BUSINESS_ENTITY_ID?.trim();
  if (!businessEntityId) {
    const entities = await db
      .select({ id: businessEntities.id, osek: businessEntities.osekMurshe })
      .from(businessEntities)
      .where(isNotNull(businessEntities.osekMurshe));
    if (entities.length === 1) {
      businessEntityId = entities[0]!.id;
    } else if (entities.length > 1) {
      console.error(
        "Multiple business entities — set BUSINESS_ENTITY_ID. Found:",
        entities.map((e) => `${e.id} (${e.osek})`).join(", "),
      );
      process.exit(1);
    } else {
      console.error("No business entity with osek_murshe.");
      process.exit(1);
    }
  }

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isAdmin, true))
    .limit(1);
  if (!admin) {
    console.error("No admin user found for requested_by_user_id.");
    process.exit(1);
  }

  const runId = `ex-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
  const [inserted] = await db
    .insert(uniformStructureExports)
    .values({
      businessEntityId,
      runId,
      periodStart,
      periodEnd,
      requestedByUserId: admin.id,
      status: "PENDING",
    })
    .returning({ id: uniformStructureExports.id });

  console.log(`Starting export runId=${runId} period=${periodStart}..${periodEnd}`);

  await runUniformStructureExport({
    exportRowId: inserted.id,
    businessEntityId,
    periodStart: start,
    periodEnd: end,
    actorUserId: admin.id,
    runId,
  });

  const [row] = await db
    .select()
    .from(uniformStructureExports)
    .where(eq(uniformStructureExports.runId, runId))
    .limit(1);

  if (!row) {
    console.error("Export row missing after run.");
    process.exit(1);
  }

  if (row.status === "FAILED") {
    console.error("FAILED:", row.errorCode, row.errorMessage);
    process.exit(1);
  }

  if (row.status !== "DONE") {
    console.error("Unexpected status:", row.status);
    process.exit(1);
  }

  const stats = row.stats as { recordCounts?: { TOTAL?: number } } | null;
  console.log("DONE");
  console.log("  runId:", runId);
  console.log("  total records:", stats?.recordCounts?.TOTAL ?? "n/a");
  console.log("  zip key:", row.s3KeyZip);
  console.log("");
  console.log("Download (admin session on sandbox):");
  console.log(`  https://sandbox.involoops.com/api/files/uniform-structure/${runId}`);
  console.log("Or: Admin → Uniform Structure → download on the DONE row.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
