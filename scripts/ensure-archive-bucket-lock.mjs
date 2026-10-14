/**
 * Idempotent: applies default Object Lock configuration (COMPLIANCE / 2557d) to the
 * archive bucket. `mc mb --with-lock` often leaves the bucket without a Rule; the
 * app SDK then rejects COMPLIANCE PutObject ("missing ObjectLockConfiguration").
 *
 * Runs in Docker before migrations (same network as MinIO). Uses S3_* env like the app.
 *
 * Skip: set SKIP_ARCHIVE_BUCKET_LOCK=1 (e.g. local without MinIO).
 */
import {
  S3Client,
  HeadBucketCommand,
  PutObjectLockConfigurationCommand,
} from "@aws-sdk/client-s3";

if (process.env.SKIP_ARCHIVE_BUCKET_LOCK === "1") {
  console.log("ensure-archive-bucket-lock: skipped (SKIP_ARCHIVE_BUCKET_LOCK=1)");
  process.exit(0);
}

const endpoint =
  process.env.S3_INTERNAL_ENDPOINT?.trim() || process.env.S3_ENDPOINT?.trim();
const bucket =
  process.env.S3_ARCHIVE_BUCKET?.trim() || "invoices-archive";
const accessKeyId = process.env.S3_ACCESS_KEY?.trim();
const secretAccessKey = process.env.S3_SECRET_KEY?.trim();
const region = process.env.S3_REGION?.trim() || "us-east-1";

if (!endpoint || !accessKeyId || !secretAccessKey) {
  console.error(
    "ensure-archive-bucket-lock: missing S3_INTERNAL_ENDPOINT or S3_ENDPOINT, S3_ACCESS_KEY, or S3_SECRET_KEY",
  );
  process.exit(1);
}

const client = new S3Client({
  region,
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  await client.send(
    new PutObjectLockConfigurationCommand({
      Bucket: bucket,
      ObjectLockConfiguration: {
        ObjectLockEnabled: "Enabled",
        Rule: {
          DefaultRetention: {
            Mode: "COMPLIANCE",
            Days: 2557,
          },
        },
      },
    }),
  );
  console.log(`ensure-archive-bucket-lock: ok (${bucket})`);
} catch (err) {
  const code = err.name ?? err.Code ?? "";
  const msg = err.message ?? String(err);
  console.error("ensure-archive-bucket-lock: failed:", code, msg);
  if (
    /InvalidBucketState/i.test(msg) ||
    code === "InvalidBucketState"
  ) {
    console.error(
      "  The archive bucket was created without object lock. Remove it and recreate:",
      "  SANDBOX: set SANDBOX_RECYCLE_ARCHIVE_BUCKET=1 in .env for one deploy, or",
      `  mc rb --force local/${bucket} then re-run minio-init.`,
    );
  }
  process.exit(1);
}
