import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getS3ServerClient } from "@/lib/s3-clients";

const BUCKET = process.env.S3_BUCKET!;

/**
 * Build a storage key in the format: {userId}/{year}/{month}/{filename}
 */
export function buildFileKey(
  userId: string,
  filename: string,
  date: Date = new Date()
): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${userId}/${year}/${month}/${filename}`;
}

/**
 * Upload a file buffer to S3/R2 and return the object key.
 */
export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  await getS3ServerClient().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return key;
}

/**
 * TTLs are kept short so a leaked URL (referer headers, browser history,
 * screenshots, logs) is only useful for a few minutes. Uploads stay a bit
 * longer because the browser may queue multiple files.
 */
const UPLOAD_URL_TTL_SECONDS = 15 * 60; // 15 minutes
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60; // 5 minutes


/**
 * Download a file from S3/R2 and return it as a Buffer.
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const response = await getS3ServerClient().send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
  const stream = response.Body;
  if (!stream) {
    throw new Error("Empty response body from S3");
  }
  const chunks: Uint8Array[] = [];
  // S3 Body is an async-iterable of Uint8Array chunks on Node.
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Delete a file from S3/R2.
 */
export async function deleteFile(key: string): Promise<void> {
  await getS3ServerClient().send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
}
