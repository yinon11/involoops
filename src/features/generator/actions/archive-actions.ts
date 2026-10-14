"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import {
  archiveObjects,
  outboundInvoices,
  users,
  type ArchiveObjectKind,
} from "@/db/schema";
import { isUserAdmin } from "@/lib/is-user-admin";
import { requirePermission } from "@/lib/rbac/authorize";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  verifyArchiveChain,
  verifyArchiveObject,
  type VerifyChainResult,
  type VerifyObjectResult,
} from "@/lib/archive/verify";
import { retrieveArchivedObject } from "@/lib/archive/retrieve";
import { and, desc, eq, gte, lte } from "drizzle-orm";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!(await isUserAdmin(session.user.id))) throw new Error("Forbidden");
  return session.user.id;
}

export interface ArchiveListFilters {
  businessEntityId?: string;
  documentId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ArchiveListRow {
  id: string;
  documentId: string;
  formattedNumber: string | null;
  documentType: string | null;
  businessEntityId: string;
  ownerEmail: string | null;
  objectKind: ArchiveObjectKind;
  s3Key: string;
  contentSha256: string;
  contentLength: number;
  chainSequence: number;
  storedAt: Date;
  retainUntil: Date;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function listArchiveObjects(
  filters: ArchiveListFilters = {},
): Promise<{ rows: ArchiveListRow[] }> {
  await requireAdmin();

  const conditions = [];
  if (filters.businessEntityId) {
    conditions.push(
      eq(archiveObjects.businessEntityId, filters.businessEntityId),
    );
  }
  if (filters.documentId) {
    conditions.push(eq(archiveObjects.documentId, filters.documentId));
  }
  if (filters.from) {
    const fromDate = new Date(filters.from);
    if (!Number.isNaN(fromDate.getTime())) {
      conditions.push(gte(archiveObjects.storedAt, fromDate));
    }
  }
  if (filters.to) {
    const toDate = new Date(filters.to);
    if (!Number.isNaN(toDate.getTime())) {
      conditions.push(lte(archiveObjects.storedAt, toDate));
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);

  const query = db
    .select({
      id: archiveObjects.id,
      documentId: archiveObjects.documentId,
      formattedNumber: outboundInvoices.formattedNumber,
      documentType: outboundInvoices.documentType,
      businessEntityId: archiveObjects.businessEntityId,
      ownerEmail: users.email,
      objectKind: archiveObjects.objectKind,
      s3Key: archiveObjects.s3Key,
      contentSha256: archiveObjects.contentSha256,
      contentLength: archiveObjects.contentLength,
      chainSequence: archiveObjects.chainSequence,
      storedAt: archiveObjects.storedAt,
      retainUntil: archiveObjects.retainUntil,
    })
    .from(archiveObjects)
    .leftJoin(
      outboundInvoices,
      eq(archiveObjects.documentId, outboundInvoices.id),
    )
    .leftJoin(users, eq(outboundInvoices.userId, users.id))
    .orderBy(desc(archiveObjects.storedAt))
    .limit(limit)
    .offset(offset);

  const raw = await (whereClause ? query.where(whereClause) : query);
  const rows: ArchiveListRow[] = raw.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    formattedNumber: r.formattedNumber ?? null,
    documentType: r.documentType ?? null,
    businessEntityId: r.businessEntityId,
    ownerEmail: r.ownerEmail ?? null,
    objectKind: r.objectKind as ArchiveObjectKind,
    s3Key: r.s3Key,
    contentSha256: r.contentSha256,
    contentLength: Number(r.contentLength),
    chainSequence: Number(r.chainSequence),
    storedAt: r.storedAt,
    retainUntil: r.retainUntil,
  }));
  return { rows };
}

export async function verifyBusinessEntityArchiveChain(
  businessEntityId: string,
): Promise<VerifyChainResult> {
  const adminId = await requireAdmin();
  await requirePermission({
    userId: adminId,
    businessEntityId,
    permission: PERMISSIONS.AUDIT_VIEW,
    route: "verifyBusinessEntityArchiveChain",
  });
  return verifyArchiveChain(businessEntityId);
}

export async function verifyArchiveObjectById(
  archiveObjectId: string,
): Promise<VerifyObjectResult> {
  await requireAdmin();
  return verifyArchiveObject(archiveObjectId);
}

export async function getArchiveDownloadUrl(params: {
  documentId: string;
  objectKind: ArchiveObjectKind;
}): Promise<{
  url: string;
  contentType: string;
  verifiedHash: boolean;
}> {
  const adminId = await requireAdmin();
  // Still runs the head-verify + EXPORTED audit entry. We just don't
  // need a presigned URL — the bytes flow through the same-origin
  // proxy so the browser never opens a cross-host connection.
  const result = await retrieveArchivedObject({
    documentId: params.documentId,
    objectKind: params.objectKind,
    actorUserId: adminId,
  });
  const url =
    `/api/files/archive` +
    `?documentId=${encodeURIComponent(params.documentId)}` +
    `&objectKind=${encodeURIComponent(params.objectKind)}`;
  return {
    url,
    contentType: result.contentType,
    verifiedHash: result.verifiedHash,
  };
}
