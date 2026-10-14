"use server";

/*
 * Admin-only read/verify actions for the document audit log.
 *
 * Writes are NOT exposed here. The only writer is `appendAuditEntry` in
 * `src/lib/audit/append.ts`, which is called from within the transactions
 * of the mutating flows in `outbound-invoice-actions.ts` and the PDF
 * route.
 *
 * RBAC: for the cross-user admin dashboard we gate on the platform
 * `isUserAdmin` flag. For per-business-entity calls (timeline, verify
 * chain) we also call `requirePermission(AUDIT_VIEW)` so denials hit the
 * rbac_denials log when a future tenant user reaches these paths.
 */

import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { db } from "@/db";
import {
  documentAuditLog,
  outboundInvoices,
  users,
  type AuditEventType,
} from "@/db/schema";
import type { DocumentType } from "@/lib/documents/types";
import { verifyChain, type VerifyChainResult } from "@/lib/audit/verify-chain";
import {
  aliasedTable,
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
} from "drizzle-orm";
import { authorize, requirePermission } from "@/lib/rbac/authorize";
import { PERMISSIONS } from "@/lib/rbac/permissions";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!(await isUserAdmin(session.user.id))) throw new Error("Forbidden");
  return session.user.id;
}

export interface AuditListFilters {
  /** Deprecated synonym for `businessEntityId`; retained for backward compat on the admin UI URL params. */
  userId?: string;
  businessEntityId?: string;
  documentId?: string;
  eventTypes?: AuditEventType[];
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditListRow {
  id: string;
  createdAt: Date;
  businessEntityId: string;
  userId: string;
  userEmail: string | null;
  documentId: string;
  documentType: DocumentType;
  formattedNumber: string | null;
  eventType: AuditEventType;
  eventPayload: Record<string, unknown>;
  actorUserId: string;
  actorEmail: string | null;
  sequenceNumber: number;
  entryHashShort: string;
  entryHash: string;
  previousHash: string | null;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

async function fetchAuditEntries(
  filters: AuditListFilters = {},
): Promise<{ rows: AuditListRow[]; total: number }> {
  const actor = aliasedTable(users, "actor_user");
  const conditions = [];
  if (filters.businessEntityId) {
    conditions.push(
      eq(documentAuditLog.businessEntityId, filters.businessEntityId),
    );
  }
  if (filters.userId) {
    conditions.push(eq(documentAuditLog.userId, filters.userId));
  }
  if (filters.documentId) {
    conditions.push(eq(documentAuditLog.documentId, filters.documentId));
  }
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    conditions.push(
      inArray(documentAuditLog.eventType, filters.eventTypes),
    );
  }
  if (filters.from) {
    const fromDate = new Date(filters.from);
    if (!Number.isNaN(fromDate.getTime())) {
      conditions.push(gte(documentAuditLog.createdAt, fromDate));
    }
  }
  if (filters.to) {
    const toDate = new Date(filters.to);
    if (!Number.isNaN(toDate.getTime())) {
      conditions.push(lte(documentAuditLog.createdAt, toDate));
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rowsQuery = db
    .select({
      id: documentAuditLog.id,
      createdAt: documentAuditLog.createdAt,
      businessEntityId: documentAuditLog.businessEntityId,
      userId: documentAuditLog.userId,
      userEmail: users.email,
      documentId: documentAuditLog.documentId,
      documentType: documentAuditLog.documentType,
      formattedNumber: outboundInvoices.formattedNumber,
      eventType: documentAuditLog.eventType,
      eventPayload: documentAuditLog.eventPayload,
      actorUserId: documentAuditLog.actorUserId,
      actorEmail: actor.email,
      sequenceNumber: documentAuditLog.sequenceNumber,
      entryHash: documentAuditLog.entryHash,
      previousHash: documentAuditLog.previousHash,
    })
    .from(documentAuditLog)
    .leftJoin(users, eq(documentAuditLog.userId, users.id))
    .leftJoin(actor, eq(documentAuditLog.actorUserId, actor.id))
    .leftJoin(outboundInvoices, eq(documentAuditLog.documentId, outboundInvoices.id))
    .orderBy(desc(documentAuditLog.createdAt))
    .limit(limit)
    .offset(offset);

  const countQuery = db
    .select({ id: documentAuditLog.id })
    .from(documentAuditLog);

  const [rawRows, countRows] = await Promise.all([
    whereClause ? rowsQuery.where(whereClause) : rowsQuery,
    whereClause ? countQuery.where(whereClause) : countQuery,
  ]);

  const rows: AuditListRow[] = rawRows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    businessEntityId: r.businessEntityId,
    userId: r.userId,
    userEmail: r.userEmail ?? null,
    documentId: r.documentId,
    documentType: r.documentType as DocumentType,
    formattedNumber: r.formattedNumber ?? null,
    eventType: r.eventType as AuditEventType,
    eventPayload: (r.eventPayload ?? {}) as Record<string, unknown>,
    actorUserId: r.actorUserId,
    actorEmail: r.actorEmail ?? null,
    sequenceNumber: Number(r.sequenceNumber),
    entryHashShort: r.entryHash.slice(0, 12),
    entryHash: r.entryHash,
    previousHash: r.previousHash ?? null,
  }));

  return { rows, total: countRows.length };
}

export async function listAuditEntries(
  filters: AuditListFilters = {},
): Promise<{ rows: AuditListRow[]; total: number }> {
  await requireAdmin();
  return fetchAuditEntries(filters);
}

export async function exportAuditEntriesJson(
  filters: AuditListFilters = {},
): Promise<string> {
  const adminId = await requireAdmin();
  // Admins short-circuit requirePermission; the call is here to ensure
  // that once tenant users are allowed into this server action, denial
  // logging lights up automatically.
  if (filters.businessEntityId) {
    await requirePermission({
      userId: adminId,
      businessEntityId: filters.businessEntityId,
      permission: PERMISSIONS.AUDIT_EXPORT,
      route: "exportAuditEntriesJson",
    });
  }
  const { rows } = await listAuditEntries({ ...filters, limit: MAX_LIMIT });
  return JSON.stringify(rows, null, 2);
}

/**
 * Verify the hash chain for a business entity. Accepts the entity id
 * directly so callers don't have to re-derive it.
 */
export async function verifyBusinessEntityChain(
  businessEntityId: string,
): Promise<VerifyChainResult> {
  const adminId = await requireAdmin();
  await requirePermission({
    userId: adminId,
    businessEntityId,
    permission: PERMISSIONS.AUDIT_VIEW,
    route: "verifyBusinessEntityChain",
  });
  return verifyChain(businessEntityId);
}

export async function listDocumentTimeline(
  documentId: string,
): Promise<AuditListRow[]> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const [invoice] = await db
    .select({ businessEntityId: outboundInvoices.businessEntityId })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.id, documentId),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .limit(1);
  if (!invoice) {
    return [];
  }

  const authz = await authorize({
    userId: session.user.id,
    businessEntityId: invoice.businessEntityId,
    permission: PERMISSIONS.AUDIT_VIEW,
    route: "listDocumentTimeline",
  });
  if (!authz.allowed) {
    return [];
  }

  const { rows } = await fetchAuditEntries({
    documentId,
    limit: MAX_LIMIT,
  });
  return rows;
}
