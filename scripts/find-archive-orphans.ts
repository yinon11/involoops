/**
 * Reconcile S3 archive objects against the `archive_objects` index
 * (Spec 05). A mid-way tx failure during issuance leaves S3 objects
 * that have no DB row — those are orphans. They can't be deleted
 * until their retention expires (COMPLIANCE), but listing them is
 * useful for cost accounting and quoting storage overhead to ops.
 *
 * Usage: `npx tsx scripts/find-archive-orphans.ts`
 * Prints one line per orphan and an exit code equal to the orphan
 * count (0 = clean).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  S3Client,
  ListObjectsV2Command,
  type _Object,
} from "@aws-sdk/client-s3";

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

const BUCKET = process.env.S3_ARCHIVE_BUCKET || "invoices-archive";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: true,
});

async function listAllS3(): Promise<_Object[]> {
  const all: _Object[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken: token,
      }),
    );
    if (res.Contents) all.push(...res.Contents);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return all;
}

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 2 });
  try {
    console.log(`[find-archive-orphans] scanning bucket=${BUCKET}…`);
    const s3Objects = await listAllS3();
    const dbRows = await sql<{ s3_key: string }[]>`
      SELECT s3_key FROM archive_objects WHERE s3_bucket = ${BUCKET}
    `;
    const knownKeys = new Set(dbRows.map((r) => r.s3_key));
    const orphans = s3Objects.filter(
      (obj) => obj.Key && !knownKeys.has(obj.Key),
    );
    for (const o of orphans) {
      console.log(`ORPHAN key=${o.Key} size=${o.Size}`);
    }
    console.log(
      `[find-archive-orphans] s3=${s3Objects.length} db=${dbRows.length} orphans=${orphans.length}`,
    );
    process.exit(orphans.length === 0 ? 0 : 1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[find-archive-orphans] fatal:", err);
  process.exit(1);
});
