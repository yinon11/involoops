import { createHash } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  archiveObjects,
  documentAuditLog,
  type ArchiveObjectKind,
} from "@/db/schema";
import { appendAuditEntry } from "@/lib/audit/append";
import { canonicalJson } from "@/lib/audit/canonical-json";
import type { CanonicalDocument } from "@/lib/signing/canonical-document";
import { ARCHIVE_OBJECT_CONTENT_TYPE, buildArchiveKey } from "./keys";
import { putArchiveObject, getArchiveBucketName } from "./s3";
import {
  computeArchiveChainEntryHash,
  type ArchiveChainInput,
} from "./hash-chain";

export type ArchiveTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const ARCHIVE_RETENTION_DAYS = 2557; // 7 years + 2 leap-day buffer.

export interface ArchiveInputSignature {
  keyId: string;
  algorithm: string;
  signatureBase64: string;
  signedAt: Date;
  canonicalJsonHash: string;
}

export interface ArchiveInputDocument {
  id: string;
  businessEntityId: string;
  userId: string;
  documentType: import("@/lib/documents/types").DocumentType;
  formattedNumber: string;
  taxYear: number;
}

export interface ArchiveDocumentParams {
  tx: ArchiveTx;
  document: ArchiveInputDocument;
  canonicalDocument: CanonicalDocument;
  canonicalJsonString: string;
  signature: ArchiveInputSignature;
  pdfBuffer: Buffer;
  actorUserId: string;
}

export interface ArchivedObjectDescriptor {
  kind: ArchiveObjectKind;
  bucket: string;
  key: string;
  versionId: string;
  contentSha256: string;
  contentLength: number;
  contentType: string;
  retainUntil: Date;
}

/**
 * Spec 05: produce the four archive objects for an issued document,
 * persist their index rows (including the per-business-entity hash
 * chain) inside the caller's transaction, and emit an `ARCHIVED`
 * audit event.
 *
 * The S3 writes happen BEFORE the database work. If any put fails,
 * throw — the caller's transaction will roll back and no DB state
 * is affected. If the DB work later fails, the S3 writes are
 * orphaned in the COMPLIANCE-locked bucket; that's a storage-cost
 * hazard, not an integrity hazard, and `scripts/find-archive-orphans.ts`
 * reconciles them periodically.
 */
export async function archiveDocument(
  params: ArchiveDocumentParams,
): Promise<{
  objectsStored: number;
  chainSequence: number;
  storedObjects: ArchivedObjectDescriptor[];
}> {
  const retainUntil = new Date(
    Date.now() + ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const auditBundle = await buildAuditBundle(
    params.tx,
    params.document.id,
  );

  // `PDF_FINAL` is written by `archivePdfFinal` only — never as part
  // of the issuance-time bundle — so the issuance-time map deliberately
  // covers just the four initial kinds.
  const bodies: Partial<Record<ArchiveObjectKind, Buffer>> = {
    CANONICAL_JSON: Buffer.from(params.canonicalJsonString, "utf8"),
    SIGNATURE: Buffer.from(
      canonicalJson({
        algorithm: params.signature.algorithm,
        canonicalJsonHash: params.signature.canonicalJsonHash,
        keyId: params.signature.keyId,
        signatureBase64: params.signature.signatureBase64,
        signedAt: params.signature.signedAt.toISOString(),
      }),
      "utf8",
    ),
    PDF: params.pdfBuffer,
    AUDIT_BUNDLE: Buffer.from(canonicalJson(auditBundle), "utf8"),
  };

  // 1) Upload each object with COMPLIANCE-mode Object Lock. Fire
  // sequentially so a mid-way failure leaves the simplest possible
  // orphan set to reconcile.
  const stored: ArchivedObjectDescriptor[] = [];
  for (const kind of ORDER) {
    const key = buildArchiveKey({
      businessEntityId: params.document.businessEntityId,
      taxYear: params.document.taxYear,
      documentType: params.document.documentType,
      formattedNumber: params.document.formattedNumber,
      objectKind: kind,
    });
    const body = bodies[kind];
    if (!body) continue;
    const sha = createHash("sha256").update(body).digest("hex");
    const put = await putArchiveObject({
      key,
      body,
      contentType: ARCHIVE_OBJECT_CONTENT_TYPE[kind],
      metadata: {
        "document-id": params.document.id,
        "business-entity-id": params.document.businessEntityId,
        "object-kind": kind,
      },
      retainUntil,
    });
    stored.push({
      kind,
      bucket: put.bucket,
      key: put.key,
      versionId: put.versionId,
      contentSha256: sha,
      contentLength: body.byteLength,
      contentType: ARCHIVE_OBJECT_CONTENT_TYPE[kind],
      retainUntil,
    });
  }

  // 2) Hash-chain + index rows. Serialise per-business-entity the
  // same way the audit chain does.
  await params.tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${"archive:" + params.document.businessEntityId}))`,
  );
  const [tail] = await params.tx
    .select({
      chainSequence: archiveObjects.chainSequence,
      chainEntryHash: archiveObjects.chainEntryHash,
    })
    .from(archiveObjects)
    .where(eq(archiveObjects.businessEntityId, params.document.businessEntityId))
    .orderBy(desc(archiveObjects.chainSequence))
    .limit(1);

  let previousHash = tail?.chainEntryHash ?? "";
  let nextSequence = (tail?.chainSequence ?? 0) + 1;
  const firstSequence = nextSequence;

  for (const object of stored) {
    const storedAt = new Date();
    const chainInput: ArchiveChainInput = {
      businessEntityId: params.document.businessEntityId,
      chainSequence: nextSequence,
      contentLength: object.contentLength,
      contentSha256: object.contentSha256,
      contentType: object.contentType,
      documentId: params.document.id,
      objectKind: object.kind,
      previousHash,
      retainUntil: object.retainUntil,
      s3Bucket: object.bucket,
      s3Key: object.key,
      s3VersionId: object.versionId,
      storedAt,
      storedByUserId: params.actorUserId,
    };
    const entryHash = computeArchiveChainEntryHash(chainInput);

    await params.tx.insert(archiveObjects).values({
      businessEntityId: params.document.businessEntityId,
      documentId: params.document.id,
      objectKind: object.kind,
      s3Bucket: object.bucket,
      s3Key: object.key,
      s3VersionId: object.versionId,
      contentSha256: object.contentSha256,
      contentLength: object.contentLength,
      contentType: object.contentType,
      retainUntil: object.retainUntil,
      storedAt,
      storedByUserId: params.actorUserId,
      chainSequence: nextSequence,
      chainEntryHash: entryHash,
      chainPreviousHash: nextSequence === 1 ? null : previousHash,
    });

    previousHash = entryHash;
    nextSequence += 1;
  }

  // 3) One ARCHIVED audit event per document.
  await appendAuditEntry({
    tx: params.tx,
    businessEntityId: params.document.businessEntityId,
    userId: params.document.userId,
    documentId: params.document.id,
    documentType: params.document.documentType,
    eventType: "ARCHIVED",
    eventPayload: {
      firstChainSequence: firstSequence,
      lastChainSequence: nextSequence - 1,
      retainUntil: retainUntil.toISOString(),
      bucket: getArchiveBucketName(),
      objectKinds: ORDER,
    },
    actor: { userId: params.actorUserId },
  });

  return {
    objectsStored: stored.length,
    chainSequence: firstSequence,
    storedObjects: stored,
  };
}

const ORDER: ArchiveObjectKind[] = [
  "CANONICAL_JSON",
  "SIGNATURE",
  "PDF",
  "AUDIT_BUNDLE",
];

/**
 * Spec 08 — append a single PDF_FINAL object to the archive after
 * SHAAM approval has been recorded on the document. Extends the
 * per-business-entity hash chain by one entry (the chain sequence
 * continues from wherever the prior write left off). Caller decides
 * whether to run inside an existing tx or open a new one.
 */
export async function archivePdfFinal(params: {
  tx?: ArchiveTx;
  document: ArchiveInputDocument;
  pdfBuffer: Buffer;
  actorUserId: string;
}): Promise<{ chainSequence: number; key: string; versionId: string }> {
  const exec = async (tx: ArchiveTx) => {
    const retainUntil = new Date(
      Date.now() + ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const kind: ArchiveObjectKind = "PDF_FINAL";
    const key = buildArchiveKey({
      businessEntityId: params.document.businessEntityId,
      taxYear: params.document.taxYear,
      documentType: params.document.documentType,
      formattedNumber: params.document.formattedNumber,
      objectKind: kind,
    });
    const sha = createHash("sha256")
      .update(params.pdfBuffer)
      .digest("hex");
    const put = await putArchiveObject({
      key,
      body: params.pdfBuffer,
      contentType: ARCHIVE_OBJECT_CONTENT_TYPE[kind],
      metadata: {
        "document-id": params.document.id,
        "business-entity-id": params.document.businessEntityId,
        "object-kind": kind,
      },
      retainUntil,
    });

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${
        "archive:" + params.document.businessEntityId
      }))`,
    );
    const [tail] = await tx
      .select({
        chainSequence: archiveObjects.chainSequence,
        chainEntryHash: archiveObjects.chainEntryHash,
      })
      .from(archiveObjects)
      .where(eq(archiveObjects.businessEntityId, params.document.businessEntityId))
      .orderBy(desc(archiveObjects.chainSequence))
      .limit(1);

    const previousHash = tail?.chainEntryHash ?? "";
    const chainSequence = (tail?.chainSequence ?? 0) + 1;
    const storedAt = new Date();
    const chainInput: ArchiveChainInput = {
      businessEntityId: params.document.businessEntityId,
      chainSequence,
      contentLength: params.pdfBuffer.byteLength,
      contentSha256: sha,
      contentType: ARCHIVE_OBJECT_CONTENT_TYPE[kind],
      documentId: params.document.id,
      objectKind: kind,
      previousHash,
      retainUntil,
      s3Bucket: put.bucket,
      s3Key: put.key,
      s3VersionId: put.versionId,
      storedAt,
      storedByUserId: params.actorUserId,
    };
    const entryHash = computeArchiveChainEntryHash(chainInput);

    await tx.insert(archiveObjects).values({
      businessEntityId: params.document.businessEntityId,
      documentId: params.document.id,
      objectKind: kind,
      s3Bucket: put.bucket,
      s3Key: put.key,
      s3VersionId: put.versionId,
      contentSha256: sha,
      contentLength: params.pdfBuffer.byteLength,
      contentType: ARCHIVE_OBJECT_CONTENT_TYPE[kind],
      retainUntil,
      storedAt,
      storedByUserId: params.actorUserId,
      chainSequence,
      chainEntryHash: entryHash,
      chainPreviousHash: chainSequence === 1 ? null : previousHash,
    });

    return { chainSequence, key: put.key, versionId: put.versionId };
  };

  if (params.tx) return exec(params.tx);
  return db.transaction(exec);
}

async function buildAuditBundle(tx: ArchiveTx, documentId: string) {
  const rows = await tx
    .select({
      sequenceNumber: documentAuditLog.sequenceNumber,
      eventType: documentAuditLog.eventType,
      eventPayload: documentAuditLog.eventPayload,
      actorUserId: documentAuditLog.actorUserId,
      actorIp: documentAuditLog.actorIp,
      actorUserAgent: documentAuditLog.actorUserAgent,
      previousHash: documentAuditLog.previousHash,
      entryHash: documentAuditLog.entryHash,
      createdAt: documentAuditLog.createdAt,
    })
    .from(documentAuditLog)
    .where(eq(documentAuditLog.documentId, documentId))
    .orderBy(asc(documentAuditLog.sequenceNumber));

  return {
    documentId,
    bundledAt: new Date().toISOString(),
    entries: rows.map((r) => ({
      sequenceNumber: Number(r.sequenceNumber),
      eventType: r.eventType,
      eventPayload: r.eventPayload as Record<string, unknown>,
      actorUserId: r.actorUserId,
      actorIp: r.actorIp,
      actorUserAgent: r.actorUserAgent,
      previousHash: r.previousHash ?? "",
      entryHash: r.entryHash,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
