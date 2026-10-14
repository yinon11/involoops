import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  archiveObjects,
  outboundInvoices,
  type ArchiveObjectKind,
} from "@/db/schema";
import { appendAuditEntry } from "@/lib/audit/append";
import { headArchiveObject } from "./s3";

export interface RetrieveResult {
  archiveObjectId: string;
  contentType: string;
  contentLength: number;
  s3Bucket: string;
  s3Key: string;
  s3VersionId: string;
  /** true when S3 HEAD's ContentLength matches the DB row. */
  verifiedHash: boolean;
}

/**
 * Fetch the metadata for an archived object and emit an EXPORTED
 * audit event. The bytes themselves are served by the same-origin
 * `/api/files/archive` route so the browser never has to talk to the
 * archive bucket directly.
 */
export async function retrieveArchivedObject(params: {
  documentId: string;
  objectKind: ArchiveObjectKind;
  actorUserId: string;
}): Promise<RetrieveResult> {
  const [row] = await db
    .select()
    .from(archiveObjects)
    .where(
      and(
        eq(archiveObjects.documentId, params.documentId),
        eq(archiveObjects.objectKind, params.objectKind),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error(
      `No archive object for document ${params.documentId}, kind ${params.objectKind}`,
    );
  }

  let verifiedHash = false;
  try {
    const head = await headArchiveObject({
      key: row.s3Key,
      versionId: row.s3VersionId,
    });
    verifiedHash =
      head.contentLength !== null &&
      head.contentLength === Number(row.contentLength);
  } catch {
    verifiedHash = false;
  }

  const [invoice] = await db
    .select({
      documentType: outboundInvoices.documentType,
    })
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, params.documentId))
    .limit(1);

  await appendAuditEntry({
    businessEntityId: row.businessEntityId,
    userId: params.actorUserId,
    documentId: params.documentId,
    documentType: invoice?.documentType ?? "TAX_INVOICE",
    eventType: "EXPORTED",
    eventPayload: {
      archiveObjectId: row.id,
      objectKind: params.objectKind,
      chainSequence: Number(row.chainSequence),
    },
    actor: { userId: params.actorUserId },
  });

  return {
    archiveObjectId: row.id,
    contentType: row.contentType,
    contentLength: Number(row.contentLength),
    s3Bucket: row.s3Bucket,
    s3Key: row.s3Key,
    s3VersionId: row.s3VersionId,
    verifiedHash,
  };
}
