/**
 * Clear the SHAAM submitted / response timestamps on documents that were
 * never submitted.
 *
 *   DATABASE_URL=... npx tsx scripts/backfill-shaam-skip-timestamps.ts [--execute]
 *
 * Both short-circuits in `submitToShaam` — NOT_APPLICABLE (proforma /
 * delivery note) and NOT_REQUIRED (below threshold, foreign currency, no
 * customer osek murshe) — used to stamp `shaamSubmittedAt` and
 * `shaamResponseAt` even though they return before any HTTP call. The
 * API then reported `shaam_submitted_at` on documents that never left
 * the system, which reads as evidence of a filing with רשות המסים. The
 * code no longer does this; this script cleans the rows written before
 * the fix.
 *
 * Safe on issued documents: the signature covers `buildCanonicalDocument`,
 * which contains no SHAAM fields (nor `version` / `updatedAt`), so
 * `verifyDocumentSignature` is unaffected. The archived S3 objects are
 * snapshots and are not touched either.
 *
 * Deliberately leaves `version` and `updatedAt` alone — this corrects a
 * field that should never have been written, and bumping the optimistic-
 * concurrency counter would make it look like a document edit.
 *
 * Dry-run by default; pass --execute to write.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, inArray, isNotNull, or, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { outboundInvoices } from "../src/db/schema/outbound-invoices";

const execute = process.argv.slice(2).includes("--execute");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const pg = postgres(connectionString, { max: 1 });
const db = drizzle(pg, { schema });

/** Statuses whose code path returns before any request is made. */
const NEVER_SUBMITTED = ["NOT_REQUIRED", "NOT_APPLICABLE"] as const;

async function main() {
  const affected = and(
    inArray(outboundInvoices.shaamStatus, [...NEVER_SUBMITTED]),
    or(
      isNotNull(outboundInvoices.shaamSubmittedAt),
      isNotNull(outboundInvoices.shaamResponseAt),
    ),
  );

  const rows = await db
    .select({
      id: outboundInvoices.id,
      formattedNumber: outboundInvoices.formattedNumber,
      documentType: outboundInvoices.documentType,
      shaamStatus: outboundInvoices.shaamStatus,
      allocationNumber: outboundInvoices.allocationNumber,
      submittedAt: outboundInvoices.shaamSubmittedAt,
    })
    .from(outboundInvoices)
    .where(affected);

  if (rows.length === 0) {
    console.log("[backfill] nothing to clean — no skipped rows carry timestamps.");
    return;
  }

  // Defensive: a row that somehow holds an allocation number really did
  // reach the ITA, whatever its status column says. Never clear those.
  const withAllocation = rows.filter((r) => r.allocationNumber);
  const safe = rows.filter((r) => !r.allocationNumber);

  for (const r of safe) {
    console.log(
      `  ${r.formattedNumber ?? r.id} ${r.documentType} ${r.shaamStatus} submitted=${r.submittedAt?.toISOString() ?? "—"}`,
    );
  }
  for (const r of withAllocation) {
    console.warn(
      `  SKIPPED ${r.formattedNumber ?? r.id} — status ${r.shaamStatus} but holds allocation ${r.allocationNumber}; left untouched for manual review.`,
    );
  }

  if (execute && safe.length > 0) {
    await db
      .update(outboundInvoices)
      .set({ shaamSubmittedAt: null, shaamResponseAt: null })
      .where(
        and(
          affected,
          sql`${outboundInvoices.allocationNumber} is null`,
        ),
      );
  }

  console.log(
    `\n[backfill] ${execute ? "DONE" : "DRY-RUN"} cleared=${safe.length} skipped_with_allocation=${withAllocation.length}`,
  );
  if (!execute) console.log("[backfill] re-run with --execute to apply.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pg.end({ timeout: 5 }));
