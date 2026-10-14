import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { archiveObjects } from "@/db/schema";
import { computeArchiveChainEntryHash } from "./hash-chain";
import { getArchiveObjectBytes } from "./s3";
import type { ArchiveObjectKind } from "@/db/schema/archive-objects";

export type VerifyChainResult =
  | { ok: true; entriesChecked: number }
  | {
      ok: false;
      brokenAt: number;
      reason: "hash_mismatch" | "previous_hash_mismatch" | "sequence_gap";
    };

export async function verifyArchiveChain(
  businessEntityId: string,
): Promise<VerifyChainResult> {
  const rows = await db
    .select()
    .from(archiveObjects)
    .where(eq(archiveObjects.businessEntityId, businessEntityId))
    .orderBy(asc(archiveObjects.chainSequence));

  let previousHash = "";
  let expectedSeq = 1;

  for (const row of rows) {
    const seq = Number(row.chainSequence);
    if (seq !== expectedSeq) {
      return { ok: false, brokenAt: seq, reason: "sequence_gap" };
    }
    const storedPrev = row.chainPreviousHash ?? "";
    if (storedPrev !== previousHash) {
      return { ok: false, brokenAt: seq, reason: "previous_hash_mismatch" };
    }
    const recomputed = computeArchiveChainEntryHash({
      businessEntityId: row.businessEntityId,
      chainSequence: seq,
      contentLength: Number(row.contentLength),
      contentSha256: row.contentSha256,
      contentType: row.contentType,
      documentId: row.documentId,
      objectKind: row.objectKind as ArchiveObjectKind,
      previousHash,
      retainUntil: row.retainUntil,
      s3Bucket: row.s3Bucket,
      s3Key: row.s3Key,
      s3VersionId: row.s3VersionId,
      storedAt: row.storedAt,
      storedByUserId: row.storedByUserId,
    });
    if (recomputed !== row.chainEntryHash) {
      return { ok: false, brokenAt: seq, reason: "hash_mismatch" };
    }
    previousHash = row.chainEntryHash;
    expectedSeq += 1;
  }

  return { ok: true, entriesChecked: rows.length };
}

export type VerifyObjectResult =
  | { ok: true; contentLength: number }
  | {
      ok: false;
      reason: "hash_mismatch" | "s3_missing" | "version_mismatch";
    };

/**
 * Download the archived bytes by `s3VersionId`, recompute SHA-256, and
 * compare against the stored `contentSha256`. A mismatch means the
 * bytes on disk don't match what the chain says they are — typically
 * only possible if the Object Lock retention was bypassed by an
 * administrator, which is a P0 breach under COMPLIANCE mode.
 */
export async function verifyArchiveObject(
  archiveObjectId: string,
): Promise<VerifyObjectResult> {
  const [row] = await db
    .select()
    .from(archiveObjects)
    .where(eq(archiveObjects.id, archiveObjectId))
    .limit(1);
  if (!row) return { ok: false, reason: "s3_missing" };

  try {
    const bytes = await getArchiveObjectBytes({
      key: row.s3Key,
      versionId: row.s3VersionId,
    });
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== row.contentSha256) {
      return { ok: false, reason: "hash_mismatch" };
    }
    if (bytes.byteLength !== Number(row.contentLength)) {
      return { ok: false, reason: "hash_mismatch" };
    }
    return { ok: true, contentLength: bytes.byteLength };
  } catch {
    return { ok: false, reason: "s3_missing" };
  }
}
