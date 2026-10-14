import {
  type S3Client,
  PutObjectCommand,
  GetObjectCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  type ObjectLockMode,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3PresignClient, getS3ServerClient } from "@/lib/s3-clients";

/**
 * Archive bucket operations use `getS3ServerClient()` (internal MinIO URL in
 * Docker when `S3_INTERNAL_ENDPOINT` is set). Presigned archive downloads use
 * `getS3PresignClient()` so the browser gets a public hostname.
 */

export function getArchiveBucketName(): string {
  return process.env.S3_ARCHIVE_BUCKET || "invoices-archive";
}

export interface ArchivePutResult {
  bucket: string;
  key: string;
  versionId: string;
  retainUntil: Date;
}

/**
 * Write an immutable archive object. Sets COMPLIANCE-mode Object Lock
 * with a 7-year retention (2557 days — adds two leap-day days of
 * buffer over 7×365) and captures the returned VersionId so the
 * caller can persist it in `archive_objects.s3_version_id`.
 *
 * Throws if the bucket's Object Lock is disabled or the version id is
 * absent from the PUT response — an unversioned write would silently
 * lose the retention guarantee, so we fail loud.
 */
export async function putArchiveObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
  retainUntil: Date;
}): Promise<ArchivePutResult> {
  const bucket = getArchiveBucketName();
  const response = await getS3ServerClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      Metadata: params.metadata,
      ObjectLockMode: "COMPLIANCE" satisfies ObjectLockMode,
      ObjectLockRetainUntilDate: params.retainUntil,
    }),
  );
  if (!response.VersionId) {
    throw new Error(
      `putArchiveObject(${params.key}): S3 did not return a VersionId. ` +
        `Confirm the bucket has Versioning + Object Lock enabled.`,
    );
  }
  return {
    bucket,
    key: params.key,
    versionId: response.VersionId,
    retainUntil: params.retainUntil,
  };
}

export interface ArchiveObjectRetention {
  mode: ObjectLockMode | null;
  retainUntil: Date | null;
}

export async function getArchiveObjectRetention(params: {
  key: string;
  versionId: string;
}): Promise<ArchiveObjectRetention> {
  const response = await getS3ServerClient().send(
    new GetObjectRetentionCommand({
      Bucket: getArchiveBucketName(),
      Key: params.key,
      VersionId: params.versionId,
    }),
  );
  return {
    mode: response.Retention?.Mode ?? null,
    retainUntil: response.Retention?.RetainUntilDate ?? null,
  };
}

export async function headArchiveObject(params: {
  key: string;
  versionId: string;
}): Promise<{ contentLength: number | null; etag: string | null }> {
  const response = await getS3ServerClient().send(
    new HeadObjectCommand({
      Bucket: getArchiveBucketName(),
      Key: params.key,
      VersionId: params.versionId,
    }),
  );
  return {
    contentLength: response.ContentLength ?? null,
    etag: response.ETag ?? null,
  };
}

export async function getArchiveObjectBytes(params: {
  key: string;
  versionId: string;
}): Promise<Buffer> {
  const response = await getS3ServerClient().send(
    new GetObjectCommand({
      Bucket: getArchiveBucketName(),
      Key: params.key,
      VersionId: params.versionId,
    }),
  );
  if (!response.Body) {
    throw new Error(`getArchiveObjectBytes(${params.key}): empty body`);
  }
  const chunks: Uint8Array[] = [];
  // @ts-expect-error S3 Body is an async iterable of chunks on Node.
  for await (const chunk of response.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function getArchiveDownloadUrl(params: {
  key: string;
  versionId: string;
  contentType: string;
}): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getArchiveBucketName(),
    Key: params.key,
    VersionId: params.versionId,
    ResponseContentType: params.contentType,
  });
  return getSignedUrl(getS3PresignClient(), command, { expiresIn: 10 * 60 });
}

/** Exposed for the setup script; callers should normally use the named helpers above. */
export function getArchiveS3Client(): S3Client {
  return getS3ServerClient();
}
