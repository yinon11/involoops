import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/audit/canonical-json";
import type { ArchiveObjectKind } from "@/db/schema/archive-objects";

/**
 * Canonical-JSON-backed SHA-256 link in the archive chain. Pure so
 * `archiveDocument` (writer) and `verifyArchiveChain` (reader) can
 * never drift — a mismatch would invalidate every historical archive
 * entry for that business entity.
 *
 * Timestamps are serialised as ISO-8601 UTC to millisecond precision;
 * identifier fields are straight strings; numbers are JSON numbers.
 */
export interface ArchiveChainInput {
  businessEntityId: string;
  chainSequence: number;
  contentLength: number;
  contentSha256: string;
  contentType: string;
  documentId: string;
  objectKind: ArchiveObjectKind;
  previousHash: string;
  retainUntil: Date;
  s3Bucket: string;
  s3Key: string;
  s3VersionId: string;
  storedAt: Date;
  storedByUserId: string;
}

export function computeArchiveChainEntryHash(
  input: ArchiveChainInput,
): string {
  const canonical = canonicalJson({
    businessEntityId: input.businessEntityId,
    chainSequence: input.chainSequence,
    contentLength: input.contentLength,
    contentSha256: input.contentSha256,
    contentType: input.contentType,
    documentId: input.documentId,
    objectKind: input.objectKind,
    previousHash: input.previousHash,
    retainUntil: input.retainUntil.toISOString(),
    s3Bucket: input.s3Bucket,
    s3Key: input.s3Key,
    s3VersionId: input.s3VersionId,
    storedAt: input.storedAt.toISOString(),
    storedByUserId: input.storedByUserId,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
