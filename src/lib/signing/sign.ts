import { createHash, sign as nodeSign } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  outboundInvoices,
  customers,
  businessEntities,
  signingKeys,
  documentSignatures,
} from "@/db/schema";
import { canonicalJson } from "@/lib/audit/canonical-json";
import { appendAuditEntry } from "@/lib/audit/append";
import {
  buildCanonicalDocument,
  type CanonicalDocument,
} from "./canonical-document";
import {
  getSigningKeyId,
  getSigningPrivateKey,
  DEFAULT_HASH_ALGORITHM,
} from "./key-store";

export type SignTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface SignatureComputation {
  canonicalDocument: CanonicalDocument;
  canonicalJsonString: string;
  canonicalJsonHash: string;
  signatureBase64: string;
  keyId: string;
  algorithm: string;
}

/**
 * Build the canonical JSON for a draft invoice and sign it in memory.
 * No DB writes, no S3 writes — callers decide when to commit.
 *
 * Spec 05 needs to produce the PDF and archive objects BEFORE the
 * signature row is persisted (so an S3 failure rolls everything
 * back), so the pure-compute step lives separately here and the
 * `persistSignatureTx` + `archiveDocument` writes all run inside the
 * same outer transaction in `issueOutboundInvoice`.
 */
export async function computeSignatureForDraft(params: {
  invoiceId: string;
}): Promise<{
  computation: SignatureComputation;
  invoiceSnapshot: typeof outboundInvoices.$inferSelect;
  businessEntity: typeof businessEntities.$inferSelect;
}> {
  const [invoice] = await db
    .select()
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, params.invoiceId))
    .limit(1);
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status !== "draft") {
    throw new Error(
      `Cannot sign invoice in status "${invoice.status}"; only drafts are signable.`,
    );
  }
  if (invoice.deletedAt) {
    throw new Error("Cannot sign a deleted invoice");
  }
  // Drafts have no fiscal number until issuance allocates one. The
  // canonical document the signature covers references the formatted
  // number, so signing without it would burn an allocation hole later.
  // `issueOutboundInvoiceOp` is responsible for allocating before this
  // function is called.
  if (invoice.formattedNumber == null || invoice.sequenceNumber == null) {
    throw new Error(
      "Cannot sign a draft that has no allocated fiscal number — " +
        "allocate via issueOutboundInvoiceOp first.",
    );
  }
  const allocatedFormattedNumber = invoice.formattedNumber;
  const allocatedSequenceNumber = invoice.sequenceNumber;

  const [entity] = await db
    .select()
    .from(businessEntities)
    .where(eq(businessEntities.id, invoice.businessEntityId))
    .limit(1);
  if (!entity) throw new Error("Business entity not found for invoice");
  if (entity.entityType === "OSEK_MURSHE" && !entity.osekMurshe) {
    throw new Error(
      "Business entity is marked as OSEK_MURSHE but has no Authorized Dealer Number set. Set it in Settings → Business Entity before issuing.",
    );
  }

  const customer = invoice.customerId
    ? (
        await db
          .select()
          .from(customers)
          .where(eq(customers.id, invoice.customerId))
          .limit(1)
      )[0] ?? null
    : null;

  const canonical = buildCanonicalDocument({
    invoice: {
      id: invoice.id,
      documentType: invoice.documentType,
      formattedNumber: allocatedFormattedNumber,
      sequenceNumber: allocatedSequenceNumber,
      taxYear: invoice.taxYear,
      invoiceDate: invoice.invoiceDate,
      printedDate: invoice.printedDate,
      items: invoice.items,
      subtotal: invoice.subtotal,
      vatRate: invoice.vatRate,
      vatAmount: invoice.vatAmount,
      total: invoice.total,
      currency: invoice.currency,
      userId: invoice.userId,
      createdAt: invoice.createdAt,
      reverseCharge: invoice.reverseCharge,
    },
    businessEntity: {
      id: entity.id,
      legalName: entity.legalName,
      osekMurshe: entity.osekMurshe,
      entityType: entity.entityType,
      address: entity.address ?? null,
    },
    customer: customer
      ? {
          id: customer.id,
          name: customer.name,
          taxId: customer.taxId ?? null,
          address: customer.address ?? null,
        }
      : null,
  });

  const canonicalJsonString = canonicalJson(
    canonical as unknown as Record<string, unknown>,
  );
  const canonicalJsonHash = createHash(DEFAULT_HASH_ALGORITHM)
    .update(canonicalJsonString, "utf8")
    .digest("hex");

  const keyId = getSigningKeyId();
  const [keyRow] = await db
    .select()
    .from(signingKeys)
    .where(and(eq(signingKeys.keyId, keyId), eq(signingKeys.status, "ACTIVE")))
    .limit(1);
  if (!keyRow) {
    throw new Error(
      `No ACTIVE signing key row found for keyId=${keyId}. Run \`npx tsx scripts/generate-dev-signing-key.ts --env dev\` (or \`--env production\`) and apply the output.`,
    );
  }

  const privateKey = getSigningPrivateKey();
  const signatureBuffer = nodeSign(
    DEFAULT_HASH_ALGORITHM,
    Buffer.from(canonicalJsonString, "utf8"),
    privateKey,
  );

  return {
    computation: {
      canonicalDocument: canonical,
      canonicalJsonString,
      canonicalJsonHash,
      signatureBase64: signatureBuffer.toString("base64"),
      keyId,
      algorithm: keyRow.algorithm,
    },
    invoiceSnapshot: invoice,
    businessEntity: entity,
  };
}

/**
 * Back-compat helper for `scripts/verify-signing.ts`: sign a draft and
 * persist the signature + status flip + SIGNED audit entry, WITHOUT
 * archiving. Production callers use `issueOutboundInvoice` in
 * `src/actions/outbound-invoice-actions.ts`, which combines signing
 * with spec-05 archiving inside a single transaction.
 */
export async function signDocument(params: {
  invoiceId: string;
  actorUserId: string;
}): Promise<{ signatureId: string; signedAt: Date; keyId: string }> {
  const { computation, invoiceSnapshot } = await computeSignatureForDraft({
    invoiceId: params.invoiceId,
  });
  const { signatureId, signedAt } = await db.transaction((tx) =>
    persistSignatureTx({
      tx,
      invoice: invoiceSnapshot,
      computation,
      actorUserId: params.actorUserId,
    }),
  );
  return { signatureId, signedAt, keyId: computation.keyId };
}

export interface PersistSignatureResult {
  signatureId: string;
  signedAt: Date;
}

/**
 * Insert the signature row, flip status to `issued`, and emit the
 * SIGNED audit entry — all inside the caller's transaction so a
 * failure rolls back archive writes performed afterwards.
 */
export async function persistSignatureTx(params: {
  tx: SignTx;
  invoice: typeof outboundInvoices.$inferSelect;
  computation: SignatureComputation;
  actorUserId: string;
  signedAt?: Date;
}): Promise<PersistSignatureResult> {
  const { tx, invoice, computation, actorUserId } = params;
  const signedAt = params.signedAt ?? new Date();

  const [signatureRow] = await tx
    .insert(documentSignatures)
    .values({
      documentId: invoice.id,
      businessEntityId: invoice.businessEntityId,
      keyId: computation.keyId,
      algorithm: computation.algorithm,
      canonicalJsonHash: computation.canonicalJsonHash,
      signatureBase64: computation.signatureBase64,
      signedAt,
      signedByUserId: actorUserId,
      canonicalJson:
        computation.canonicalDocument as unknown as Record<string, unknown>,
      version: 1,
    })
    .returning({ id: documentSignatures.id });

  await tx
    .update(outboundInvoices)
    .set({
      status: "issued",
      version: invoice.version + 1,
      updatedAt: signedAt,
    })
    .where(eq(outboundInvoices.id, invoice.id));

  await appendAuditEntry({
    tx,
    businessEntityId: invoice.businessEntityId,
    userId: invoice.userId,
    documentId: invoice.id,
    documentType: invoice.documentType,
    eventType: "SIGNED",
    eventPayload: {
      signatureId: signatureRow.id,
      canonicalJsonHash: computation.canonicalJsonHash,
      keyId: computation.keyId,
      algorithm: computation.algorithm,
      signedAt: signedAt.toISOString(),
    },
    actor: { userId: actorUserId },
  });

  return { signatureId: signatureRow.id, signedAt };
}
