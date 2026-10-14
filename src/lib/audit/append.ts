import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documentAuditLog } from "@/db/schema/document-audit-log";
import type { AuditEventType } from "@/db/schema/document-audit-log";
import type { DocumentType } from "@/lib/documents/types";
import { canonicalJson } from "./canonical-json";

/**
 * Drizzle transaction handle, as surfaced by `db.transaction(tx => ...)`.
 */
export type AuditTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AppendAuditEntryParams {
  /** Authoritative scope of the hash chain (spec 03). */
  businessEntityId: string;
  /**
   * Denormalised owner of the business entity at the time of the write.
   * Stored on the row for convenience queries; does NOT participate in
   * the canonical hash input.
   */
  userId: string;
  documentId: string;
  documentType: DocumentType;
  eventType: AuditEventType;
  eventPayload: Record<string, unknown>;
  actor: {
    userId: string;
    ip?: string | null;
    userAgent?: string | null;
  };
  /**
   * When provided, the append is performed inside the caller's
   * transaction and participates in its commit / rollback lifecycle.
   */
  tx?: AuditTx;
}

export interface AppendAuditEntryResult {
  sequenceNumber: number;
  entryHash: string;
  createdAt: Date;
}

export async function appendAuditEntry(
  params: AppendAuditEntryParams,
): Promise<AppendAuditEntryResult> {
  if (params.tx) {
    return appendInTx(params.tx, params);
  }
  return db.transaction((tx) => appendInTx(tx, params));
}

async function appendInTx(
  tx: AuditTx,
  params: AppendAuditEntryParams,
): Promise<AppendAuditEntryResult> {
  const {
    businessEntityId,
    userId,
    documentId,
    documentType,
    eventType,
    eventPayload,
    actor,
  } = params;

  // Serialise concurrent appends for this business entity.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${"audit:" + businessEntityId}))`,
  );

  const [previous] = await tx
    .select({
      sequenceNumber: documentAuditLog.sequenceNumber,
      entryHash: documentAuditLog.entryHash,
    })
    .from(documentAuditLog)
    .where(eq(documentAuditLog.businessEntityId, businessEntityId))
    .orderBy(desc(documentAuditLog.sequenceNumber))
    .limit(1);

  const sequenceNumber = (previous?.sequenceNumber ?? 0) + 1;
  const previousHash = previous?.entryHash ?? "";
  const createdAt = new Date();

  const entryHash = computeEntryHash({
    businessEntityId,
    documentId,
    documentType,
    eventType,
    eventPayload,
    actorUserId: actor.userId,
    actorIp: actor.ip ?? null,
    actorUserAgent: actor.userAgent ?? null,
    sequenceNumber,
    createdAt,
    previousHash,
  });

  const [inserted] = await tx
    .insert(documentAuditLog)
    .values({
      businessEntityId,
      userId,
      documentId,
      documentType,
      eventType,
      eventPayload: eventPayload as Record<string, unknown>,
      actorUserId: actor.userId,
      actorIp: actor.ip ?? null,
      actorUserAgent: actor.userAgent ?? null,
      previousHash: sequenceNumber === 1 ? null : previousHash,
      entryHash,
      sequenceNumber,
      createdAt,
    })
    .returning({
      sequenceNumber: documentAuditLog.sequenceNumber,
      entryHash: documentAuditLog.entryHash,
      createdAt: documentAuditLog.createdAt,
    });

  return {
    sequenceNumber: Number(inserted.sequenceNumber),
    entryHash: inserted.entryHash,
    createdAt: inserted.createdAt,
  };
}

export interface EntryHashInput {
  businessEntityId: string;
  documentId: string;
  documentType: DocumentType;
  eventType: AuditEventType;
  eventPayload: Record<string, unknown>;
  actorUserId: string;
  actorIp: string | null;
  actorUserAgent: string | null;
  sequenceNumber: number;
  createdAt: Date;
  previousHash: string;
}

/**
 * Pure hash function reused by `verifyChain`. The input ordering and
 * serialisation MUST stay byte-identical to the insert path; any drift
 * invalidates historical chains.
 */
export function computeEntryHash(input: EntryHashInput): string {
  const canonical = canonicalJson({
    actorIp: input.actorIp,
    actorUserAgent: input.actorUserAgent,
    actorUserId: input.actorUserId,
    businessEntityId: input.businessEntityId,
    createdAt: input.createdAt.toISOString(),
    documentId: input.documentId,
    documentType: input.documentType,
    eventPayload: input.eventPayload,
    eventType: input.eventType,
    previousHash: input.previousHash,
    sequenceNumber: input.sequenceNumber,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
