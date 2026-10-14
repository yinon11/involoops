import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { archiveObjects } from "@/db/schema";
import type { ArchiveObjectKind } from "@/db/schema/archive-objects";
import { putArchiveObject } from "@/lib/archive/s3";
import { computeArchiveChainEntryHash } from "@/lib/archive/hash-chain";
import { ARCHIVE_RETENTION_DAYS } from "@/lib/archive/store";

/**
 * Writes a single archive-objects row + S3 object for an auxiliary
 * artefact (not a document PDF). Extends the per-business-entity
 * chain by one entry. Mirrors archivePdfFinal's structure but
 * doesn't require a DocumentType reference.
 */
export async function archiveAuxiliary(params: {
  businessEntityId: string;
  actorUserId: string;
  documentId: string;
  kind: ArchiveObjectKind;
  bytes: Buffer;
  contentType: string;
  /** File extension for the S3 key. Defaults to `bin`. */
  extension?: string;
}): Promise<{ key: string }> {
  const retainUntil = new Date(
    Date.now() + ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const sha = createHash("sha256").update(params.bytes).digest("hex");
  const key = `${params.businessEntityId}/aux/${params.kind}-${sha.slice(0, 8)}-${Date.now()}.${params.extension ?? "bin"}`;
  const put = await putArchiveObject({
    key,
    body: params.bytes,
    contentType: params.contentType,
    metadata: {
      "business-entity-id": params.businessEntityId,
      "object-kind": params.kind,
      "export-id": params.documentId,
    },
    retainUntil,
  });

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"archive:" + params.businessEntityId}))`,
    );
    const [tail] = await tx
      .select({
        chainSequence: archiveObjects.chainSequence,
        chainEntryHash: archiveObjects.chainEntryHash,
      })
      .from(archiveObjects)
      .where(eq(archiveObjects.businessEntityId, params.businessEntityId))
      .orderBy(sql`${archiveObjects.chainSequence} DESC`)
      .limit(1);
    const previousHash = tail?.chainEntryHash ?? "";
    const chainSequence = (tail?.chainSequence ?? 0) + 1;
    const storedAt = new Date();
    const entryHash = computeArchiveChainEntryHash({
      businessEntityId: params.businessEntityId,
      chainSequence,
      contentLength: params.bytes.byteLength,
      contentSha256: sha,
      contentType: params.contentType,
      documentId: params.documentId,
      objectKind: params.kind,
      previousHash,
      retainUntil,
      s3Bucket: put.bucket,
      s3Key: put.key,
      s3VersionId: put.versionId,
      storedAt,
      storedByUserId: params.actorUserId,
    });
    await tx.insert(archiveObjects).values({
      businessEntityId: params.businessEntityId,
      documentId: params.documentId,
      objectKind: params.kind,
      s3Bucket: put.bucket,
      s3Key: put.key,
      s3VersionId: put.versionId,
      contentSha256: sha,
      contentLength: params.bytes.byteLength,
      contentType: params.contentType,
      retainUntil,
      storedAt,
      storedByUserId: params.actorUserId,
      chainSequence,
      chainEntryHash: entryHash,
      chainPreviousHash: chainSequence === 1 ? null : previousHash,
    });
  });
  return { key: put.key };
}
