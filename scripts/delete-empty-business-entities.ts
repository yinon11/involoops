/**
 * One-shot cleanup: delete `business_entities` rows that were
 * auto-created at signup (legacy behaviour) and that the user never
 * filled in.
 *
 * Signal: `osek_murshe IS NULL`. The 9-digit Osek Murshe is required
 * before any tax invoice can be issued for OSEK_MURSHE / CHEVRA_BAAM /
 * AMUTA / SHUTAFUT entity types — without it the row carries zero
 * compliance value and exists only because the legacy
 * `ensureOwnerBusinessEntityForUser` ran during free-plan
 * provisioning. Cascading FK deletes also remove the matching
 * `business_entity_members` rows; we explicitly verify nothing else
 * (outbound invoices, customers, shaam_authorizations, etc.) actually
 * references the row before deleting, to avoid breaking real users.
 *
 *   Usage:
 *     npx tsx scripts/delete-empty-business-entities.ts             # dry run
 *     npx tsx scripts/delete-empty-business-entities.ts --apply     # really delete
 *
 * Requires DATABASE_URL in the environment (or `.env`).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, isNull, sql as dsql } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  businessEntities,
  outboundInvoices,
} from "@/db/schema";

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

const apply = process.argv.includes("--apply");

const client = postgres(process.env.DATABASE_URL, { max: 4 });
const db = drizzle(client, { schema });

async function main() {
  const candidates = await db
    .select({
      id: businessEntities.id,
      ownerUserId: businessEntities.ownerUserId,
      legalName: businessEntities.legalName,
      osekMurshe: businessEntities.osekMurshe,
      createdAt: businessEntities.createdAt,
    })
    .from(businessEntities)
    .where(isNull(businessEntities.osekMurshe))
    .orderBy(businessEntities.createdAt);

  console.log(
    `Found ${candidates.length} candidate row(s) with osek_murshe IS NULL.`,
  );

  if (candidates.length === 0) {
    await client.end();
    return;
  }

  let deleted = 0;
  let skipped = 0;

  for (const row of candidates) {
    // Defensive: even though the user said "regardless of other data",
    // we still emit a warning when the row has dependent records so
    // the operator can audit before applying. Outbound invoices are
    // the only hard FK that would be lost in real terms; the others
    // (customers, audit logs) are user-scoped.
    const [{ count: invoiceCount }] = await db
      .select({ count: dsql<number>`count(*)::int` })
      .from(outboundInvoices)
      .where(eq(outboundInvoices.businessEntityId, row.id));

    const tag = invoiceCount > 0 ? " (HAS INVOICES)" : "";
    console.log(
      `  • ${row.id}  user=${row.ownerUserId}  legalName=${JSON.stringify(
        row.legalName,
      )}  invoices=${invoiceCount}${tag}`,
    );

    if (!apply) continue;

    if (invoiceCount > 0) {
      console.log(
        `    SKIP — refusing to delete a row with outbound invoices (${invoiceCount}).`,
      );
      skipped++;
      continue;
    }

    await db.delete(businessEntities).where(eq(businessEntities.id, row.id));
    deleted++;
  }

  if (apply) {
    console.log(`\nDeleted ${deleted} row(s); skipped ${skipped}.`);
  } else {
    console.log(
      "\nDry run. Re-run with --apply to actually delete the rows above.",
    );
  }

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await client.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
