import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documentAuditLog } from "@/db/schema/document-audit-log";
import { computeEntryHash } from "./append";
import type { DocumentType } from "@/lib/documents/types";
import type { AuditEventType } from "@/db/schema/document-audit-log";

export type VerifyChainResult =
  | { ok: true; entriesChecked: number }
  | {
      ok: false;
      brokenAt: number;
      reason: "hash_mismatch" | "previous_hash_mismatch";
    };

/**
 * Walks the full audit chain for a business entity from sequence 1
 * upward and recomputes each `entryHash`. A broken chain short-circuits
 * on the first mismatch.
 */
export async function verifyChain(
  businessEntityId: string,
): Promise<VerifyChainResult> {
  const rows = await db
    .select()
    .from(documentAuditLog)
    .where(eq(documentAuditLog.businessEntityId, businessEntityId))
    .orderBy(asc(documentAuditLog.sequenceNumber));

  let previousHash = "";
  let expectedSeq = 1;

  for (const row of rows) {
    const rowSeq = Number(row.sequenceNumber);
    if (rowSeq !== expectedSeq) {
      return {
        ok: false,
        brokenAt: rowSeq,
        reason: "previous_hash_mismatch",
      };
    }

    const storedPrev = row.previousHash ?? "";
    if (storedPrev !== previousHash) {
      return { ok: false, brokenAt: rowSeq, reason: "previous_hash_mismatch" };
    }

    const recomputed = computeEntryHash({
      businessEntityId: row.businessEntityId,
      documentId: row.documentId,
      documentType: row.documentType as DocumentType,
      eventType: row.eventType as AuditEventType,
      eventPayload: row.eventPayload as Record<string, unknown>,
      actorUserId: row.actorUserId,
      actorIp: row.actorIp,
      actorUserAgent: row.actorUserAgent,
      sequenceNumber: rowSeq,
      createdAt: row.createdAt,
      previousHash,
    });

    if (recomputed !== row.entryHash) {
      return { ok: false, brokenAt: rowSeq, reason: "hash_mismatch" };
    }

    previousHash = row.entryHash;
    expectedSeq += 1;
  }

  return { ok: true, entriesChecked: rows.length };
}
