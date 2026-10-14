"use server";

/*
 * Document number allocation — ITA Bookkeeping Rules, 1973 compliance.
 *
 * Regression scenarios (TODO: port to real tests when a runner is added;
 * `scripts/verify-numbering.ts` exercises all of these today):
 *   1. Concurrency — 10 parallel allocations for the same
 *      (businessEntity, type, year) must receive exactly 1..10 with no
 *      duplicates or gaps.
 *   2. Gap prevention — a failing invoice insert must not consume a number.
 *   3. Business-entity separation — two entities each start at 1.
 *   4. Type separation — TAX_INVOICE and RECEIPT for the same entity
 *      each start at 1.
 *   5. Year rollover — first document of a new tax year starts at 1.
 *   6. Format determinism — formatDocumentNumber(TAX_INVOICE, 2026, 42) is
 *      always "2026-TI-000042".
 */

import { db } from "@/db";
import { documentNumberSequences } from "@/db/schema";
import { auth } from "@/auth";
import { and, eq, sql } from "drizzle-orm";
import { formatDocumentNumber } from "@/lib/documents/format-number";
import type { DocumentType } from "@/lib/documents/types";
import { getBusinessEntityForUser } from "@/lib/rbac/current-business-entity";
import { requirePermission } from "@/lib/rbac/authorize";
import { PERMISSIONS } from "@/lib/rbac/permissions";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export interface DocumentNumberAllocation {
  sequenceNumber: number;
  formattedNumber: string;
  documentType: DocumentType;
  taxYear: number;
}

export async function allocateDocumentNumberTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    businessEntityId: string;
    userId: string;
    documentType: DocumentType;
    taxYear: number;
  },
): Promise<DocumentNumberAllocation> {
  const { businessEntityId, userId, documentType, taxYear } = params;

  // Defense-in-depth against counter drift: take the GREATEST of the
  // in-table counter and the live MAX(sequence_number) already present
  // in `outbound_invoices` for the same group, then add one. Without
  // this floor, a sequence row whose `current_number` somehow fell
  // behind reality (e.g. pre-c7decf2 drafts that reserved numbers
  // outside the counter — see migration 0012) would hand back a
  // colliding number and the subsequent UPDATE on outbound_invoices
  // would blow up against `outbound_invoices_user_type_year_seq_unique`.
  // The advisory lock + `RETURNING` keep this race-safe.
  const rows = await tx.execute<{ current_number: string | number }>(sql`
    WITH live_max AS (
      SELECT COALESCE(MAX(sequence_number), 0) AS max_seq
      FROM outbound_invoices
      WHERE business_entity_id = ${businessEntityId}
        AND document_type      = ${documentType}
        AND tax_year           = ${taxYear}
    )
    INSERT INTO document_number_sequences
      (business_entity_id, user_id, document_type, tax_year, current_number, updated_at)
    VALUES (
      ${businessEntityId},
      ${userId},
      ${documentType},
      ${taxYear},
      GREATEST((SELECT max_seq FROM live_max), 0) + 1,
      NOW()
    )
    ON CONFLICT (business_entity_id, document_type, tax_year)
    DO UPDATE SET
      current_number = GREATEST(
        document_number_sequences.current_number,
        (SELECT max_seq FROM live_max)
      ) + 1,
      updated_at = NOW()
    RETURNING current_number
  `);

  const raw = rows[0]?.current_number;
  if (raw === undefined || raw === null) {
    throw new Error("allocateDocumentNumberTx: no row returned from upsert");
  }
  const sequenceNumber = Number(raw);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new Error(
      `allocateDocumentNumberTx: invalid current_number ${String(raw)}`,
    );
  }

  return {
    sequenceNumber,
    formattedNumber: formatDocumentNumber(documentType, taxYear, sequenceNumber),
    documentType,
    taxYear,
  };
}

export async function allocateDocumentNumber(params: {
  documentType: DocumentType;
  taxYear: number;
}): Promise<DocumentNumberAllocation> {
  const userId = await requireUserId();
  const entity = await getBusinessEntityForUser(userId);
  await requirePermission({
    userId,
    businessEntityId: entity.id,
    permission: PERMISSIONS.DOCUMENT_CREATE_DRAFT,
    route: "allocateDocumentNumber",
  });
  return db.transaction((tx) =>
    allocateDocumentNumberTx(tx, {
      businessEntityId: entity.id,
      userId,
      ...params,
    }),
  );
}

export async function previewNextDocumentNumber(params?: {
  documentType?: DocumentType;
  taxYear?: number;
}): Promise<{
  documentType: DocumentType;
  taxYear: number;
  sequenceNumber: number;
  formattedNumber: string;
}> {
  const userId = await requireUserId();
  const entity = await getBusinessEntityForUser(userId);
  await requirePermission({
    userId,
    businessEntityId: entity.id,
    permission: PERMISSIONS.DOCUMENT_VIEW,
    route: "previewNextDocumentNumber",
  });
  const documentType: DocumentType = params?.documentType ?? "TAX_INVOICE";
  const taxYear = params?.taxYear ?? new Date().getFullYear();

  const row = await db
    .select({ currentNumber: documentNumberSequences.currentNumber })
    .from(documentNumberSequences)
    .where(
      and(
        eq(documentNumberSequences.businessEntityId, entity.id),
        eq(documentNumberSequences.documentType, documentType),
        eq(documentNumberSequences.taxYear, taxYear),
      ),
    )
    .limit(1);

  const next = (row[0]?.currentNumber ?? 0) + 1;
  return {
    documentType,
    taxYear,
    sequenceNumber: next,
    formattedNumber: formatDocumentNumber(documentType, taxYear, next),
  };
}
