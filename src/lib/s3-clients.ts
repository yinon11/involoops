import { S3Client } from "@aws-sdk/client-s3";

function credentials() {
  return {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  };
}

function baseConfig() {
  return {
    region: process.env.S3_REGION || "auto",
    credentials: credentials(),
    forcePathStyle: true as const,
  };
}

let serverClient: S3Client | null = null;

/**
 * S3 SDK client for server-side reads/writes (Node in Docker, cron, etc.).
 * Prefer the Docker network URL (`http://minio:9000`) so DNS for the public
 * API hostname is not required for archive issuance or upload processing.
 */
export function getS3ServerClient(): S3Client {
  if (!serverClient) {
    const endpoint =
      process.env.S3_INTERNAL_ENDPOINT?.trim() || process.env.S3_ENDPOINT;
    if (!endpoint) {
      throw new Error("S3_ENDPOINT (or S3_INTERNAL_ENDPOINT) must be set");
    }
    serverClient = new S3Client({
      ...baseConfig(),
      endpoint,
    });
  }
  return serverClient;
}
