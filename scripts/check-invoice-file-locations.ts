/**
 * READ-ONLY diagnostic: where do invoice files actually live?
 *
 * `/api/files/preview` refuses any object whose storage key is not under the
 * requesting user's id. On an account whose rows were re-owned out of band —
 * the invoice moved to a new user id, the S3 objects did not — that check
 * fires on every historical file and the user sees "stored under an
 * unexpected path".
 *
 * Before anything is changed, we need to know which of two situations we are
 * in, and guessing is not good enough when the answer decides whether a
 * production UPDATE is safe:
 *
 *   A. The objects are still at the OLD prefix. `file_url` is correct and the
 *      code's check is wrong. Fix belongs in code; touch no data.
 *   B. The objects were copied to the NEW prefix. `file_url` is stale. A
 *      rewrite is safe — but ONLY once we know the object is really there,
 *      because `file_url` is the sole record of where each object lives.
 *
 * This script writes nothing. It issues HEAD requests for a sample of the
 * mismatched rows at both prefixes and prints a tally.
 *
 *   docker compose exec app npx tsx scripts/check-invoice-file-locations.ts
 *   # or, outside docker, with the app's env loaded:
 *   npx tsx scripts/check-invoice-file-locations.ts
 *
 * Optional: SAMPLE=50 to check more rows (default 10).
 */

import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { and, isNotNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { invoices } from "../src/db/schema";
import { getS3ServerClient } from "../src/lib/s3-clients";
import { resolveStorageKeyFromFileUrl } from "../src/lib/storage-key";

const BUCKET = process.env.S3_BUCKET;
const SAMPLE = Number(process.env.SAMPLE ?? 10);

type Presence = "found" | "missing" | "error";

async function head(key: string): Promise<Presence> {
  if (!BUCKET) return "error";
  try {
    await getS3ServerClient().send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    return "found";
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    // NotFound / NoSuchKey mean the object genuinely is not there. Anything
    // else (credentials, network, bucket policy) is NOT evidence of absence
    // and must not be reported as such.
    return name === "NotFound" || name === "NoSuchKey" ? "missing" : "error";
  }
}

async function main() {
  if (!BUCKET) {
    console.error("S3_BUCKET is not set — run this with the app's env loaded.");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: invoices.id,
      userId: invoices.userId,
      fileUrl: invoices.fileUrl,
    })
    .from(invoices)
    .where(
      and(
        isNotNull(invoices.fileUrl),
        sql`${invoices.fileUrl} NOT LIKE ${invoices.userId} || '/%'`,
        sql`${invoices.fileUrl} NOT LIKE 'http%'`,
      ),
    )
    .limit(SAMPLE);

  console.log(`bucket: ${BUCKET}`);
  console.log(`mismatched rows sampled: ${rows.length}\n`);

  const tally = { oldOnly: 0, newOnly: 0, both: 0, neither: 0, errors: 0 };

  for (const row of rows) {
    const oldKey = resolveStorageKeyFromFileUrl(row.fileUrl ?? "");
    if (!oldKey) continue;
    // Same path, re-prefixed with the id the row carries today.
    const newKey = `${row.userId}/${oldKey.slice(oldKey.indexOf("/") + 1)}`;

    const [atOld, atNew] = await Promise.all([head(oldKey), head(newKey)]);

    if (atOld === "error" || atNew === "error") tally.errors++;
    else if (atOld === "found" && atNew === "found") tally.both++;
    else if (atOld === "found") tally.oldOnly++;
    else if (atNew === "found") tally.newOnly++;
    else tally.neither++;

    console.log(
      `${row.id}\n  stored key : ${oldKey}  -> ${atOld}\n  would-be   : ${newKey}  -> ${atNew}\n`,
    );
  }

  console.log("── tally ──");
  console.log(`  only at stored (old) prefix : ${tally.oldOnly}`);
  console.log(`  only at row-owner prefix    : ${tally.newOnly}`);
  console.log(`  at both                     : ${tally.both}`);
  console.log(`  at neither                  : ${tally.neither}`);
  console.log(`  could not tell (errors)     : ${tally.errors}`);
  console.log("\nAll 'only at stored (old) prefix' => do NOT rewrite file_url;");
  console.log("the stored path is the only pointer to the object. Fix in code.");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
