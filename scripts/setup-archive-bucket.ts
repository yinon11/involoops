/**
 * One-shot bootstrap for the 7-year archive bucket (Spec 05).
 *
 * Idempotent: if the bucket exists and is already configured
 * correctly, the script exits 0 without changes. Otherwise it
 * creates the bucket with Object Lock enabled at creation time
 * (can't be enabled later), enables Versioning, and installs a
 * default Object Lock configuration of COMPLIANCE / 2557 days.
 *
 * Usage: `npx tsx scripts/setup-archive-bucket.ts`
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  PutObjectLockConfigurationCommand,
  GetObjectLockConfigurationCommand,
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
const RETENTION_DAYS = 2557;

const s3 = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint:
    process.env.S3_INTERNAL_ENDPOINT?.trim() || process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: true,
});

async function exists(bucket: string): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`[setup-archive] target bucket: ${BUCKET}`);
  console.log(
    `[setup-archive] endpoint: ${process.env.S3_INTERNAL_ENDPOINT?.trim() || process.env.S3_ENDPOINT || "(default)"}`,
  );

  const alreadyExists = await exists(BUCKET);
  if (!alreadyExists) {
    console.log("[setup-archive] creating bucket with Object Lock enabled…");
    await s3.send(
      new CreateBucketCommand({
        Bucket: BUCKET,
        ObjectLockEnabledForBucket: true,
      }),
    );
  } else {
    console.log("[setup-archive] bucket already exists; verifying config…");
  }

  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: BUCKET,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );

  await s3.send(
    new PutObjectLockConfigurationCommand({
      Bucket: BUCKET,
      ObjectLockConfiguration: {
        ObjectLockEnabled: "Enabled",
        Rule: {
          DefaultRetention: {
            Mode: "COMPLIANCE",
            Days: RETENTION_DAYS,
          },
        },
      },
    }),
  );

  const cfg = await s3.send(
    new GetObjectLockConfigurationCommand({ Bucket: BUCKET }),
  );
  const rule = cfg.ObjectLockConfiguration?.Rule;
  const enabled = cfg.ObjectLockConfiguration?.ObjectLockEnabled === "Enabled";
  console.log("[setup-archive] done.");
  console.log(
    `  ObjectLockEnabled=${enabled} mode=${rule?.DefaultRetention?.Mode} days=${rule?.DefaultRetention?.Days}`,
  );
  console.log("");
  console.log(
    "  REMINDER: COMPLIANCE mode cannot be relaxed by any IAM user — including root — for the duration of the retention.",
  );
}

main().catch((err) => {
  console.error("[setup-archive] fatal:", err);
  process.exit(1);
});
