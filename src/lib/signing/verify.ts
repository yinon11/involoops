import { createHash, verify as nodeVerify } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  outboundInvoices,
  customers,
  businessEntities,
  signingKeys,
  documentSignatures,
} from "@/db/schema";
import { canonicalJson } from "@/lib/audit/canonical-json";
import { loadPublicKey, DEFAULT_HASH_ALGORITHM } from "./key-store";
import {
  buildCanonicalDocument,
  type CanonicalDocument,
} from "./canonical-document";

export type VerifyFailureReason =
  | "signature_not_found"
  | "key_not_found"
  | "key_revoked"
  | "signature_invalid"
  | "document_modified_after_signing";

/**
 * A REVOKED key does not verify.
 * `revokedAfter` set: signatures strictly after that instant fail; earlier
 * ones stay valid. `revokedAfter` null: every signature from the key fails.
 */
export function signatureRejectedForRevocation(
  status: string,
  revokedAfter: Date | null,
  signedAt: Date,
): boolean {
  if (status !== "REVOKED") return false;
  if (revokedAfter == null) return true;
  return signedAt.getTime() > revokedAfter.getTime();
}

export type VerifyDocumentResult =
  | {
      ok: true;
      signedAt: Date;
      keyId: string;
      canonicalJson: CanonicalDocument;
      formattedNumber: string;
      businessEntityLegalName: string;
      customerName: string | null;
      grandTotal: string;
      currency: string;
      issueDate: string;
    }
  | { ok: false; reason: VerifyFailureReason };

/**
 * Verify a document's digital signature.
 *
 * Two checks:
 *   1. Cryptographic verification of the stored signature against the
 *      stored canonical JSON using the public key identified by
 *      `keyId`. If the stored canonical JSON doesn't match the
 *      signature, the signature is forged / corrupted.
 *   2. Rebuild the canonical JSON from the LIVE invoice rows and
 *      compare its hash to `canonicalJsonHash`. If they differ, the
 *      invoice has been tampered with post-signing (e.g. direct DB
 *      edit that bypassed the application layer).
 *
 * Either failure returns `ok: false` with a specific reason — the
 * public /verify page surfaces this to document recipients without
 * exposing internal state.
 */
export async function verifyDocumentSignature(
  invoiceId: string,
): Promise<VerifyDocumentResult> {
  const [signature] = await db
    .select()
    .from(documentSignatures)
    .where(eq(documentSignatures.documentId, invoiceId))
    .limit(1);
  if (!signature) return { ok: false, reason: "signature_not_found" };

  const [keyRow] = await db
    .select()
    .from(signingKeys)
    .where(eq(signingKeys.keyId, signature.keyId))
    .limit(1);
  if (!keyRow) return { ok: false, reason: "key_not_found" };
  if (
    signatureRejectedForRevocation(
      keyRow.status,
      keyRow.revokedAfter,
      signature.signedAt,
    )
  ) {
    return { ok: false, reason: "key_revoked" };
  }

  const storedCanonical = signature.canonicalJson as unknown as CanonicalDocument;
  const storedCanonicalString = canonicalJson(
    storedCanonical as unknown as Record<string, unknown>,
  );

  // 1) cryptographic check
  const signatureBuffer = Buffer.from(signature.signatureBase64, "base64");
  const publicKey = loadPublicKey(keyRow.publicKeyPem);
  const cryptoOk = nodeVerify(
    DEFAULT_HASH_ALGORITHM,
    Buffer.from(storedCanonicalString, "utf8"),
    publicKey,
    signatureBuffer,
  );
  if (!cryptoOk) return { ok: false, reason: "signature_invalid" };

  // 2) tamper check — rebuild canonical from live rows and compare hash
  const [invoice] = await db
    .select()
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, invoiceId))
    .limit(1);
  if (invoice) {
    const [entity] = await db
      .select()
      .from(businessEntities)
      .where(eq(businessEntities.id, invoice.businessEntityId))
      .limit(1);
    const customer = invoice.customerId
      ? (
          await db
            .select()
            .from(customers)
            .where(eq(customers.id, invoice.customerId))
            .limit(1)
        )[0] ?? null
      : null;

    if (
      entity &&
      invoice.formattedNumber != null &&
      invoice.sequenceNumber != null
    ) {
      // A credit note is signed with a frozen snapshot of the invoice it
      // reverses. That snapshot is not a column on the credit note, so
      // rebuilding without it never matches — every credit note looked
      // modified. Take it from the signed document. The link itself is a
      // column: if it no longer points at that invoice, the note changed.
      const signedReference = storedCanonical.reference;
      if (
        signedReference &&
        invoice.referencesDocumentId !== signedReference.documentId
      ) {
        return { ok: false, reason: "document_modified_after_signing" };
      }
      const liveCanonical = buildCanonicalDocument({
        invoice: {
          id: invoice.id,
          documentType: invoice.documentType,
          formattedNumber: invoice.formattedNumber,
          sequenceNumber: invoice.sequenceNumber,
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
        ...(signedReference
          ? {
              reference: {
                documentId: signedReference.documentId,
                formattedNumber: signedReference.formattedNumber,
                issueDate: signedReference.issueDate,
                grandTotal: signedReference.grandTotal,
                canonicalJsonHash: signedReference.canonicalJsonHash,
              },
            }
          : {}),
      });
      const liveHash = createHash(DEFAULT_HASH_ALGORITHM)
        .update(
          canonicalJson(liveCanonical as unknown as Record<string, unknown>),
          "utf8",
        )
        .digest("hex");
      if (liveHash !== signature.canonicalJsonHash) {
        return { ok: false, reason: "document_modified_after_signing" };
      }
    }
  }

  return {
    ok: true,
    signedAt: signature.signedAt,
    keyId: signature.keyId,
    canonicalJson: storedCanonical,
    formattedNumber: storedCanonical.formattedNumber,
    businessEntityLegalName: storedCanonical.businessEntity.legalName,
    customerName: storedCanonical.customer.id
      ? storedCanonical.customer.name
      : null,
    grandTotal: storedCanonical.totals.grandTotal,
    currency: storedCanonical.totals.currency,
    issueDate: storedCanonical.issueDate,
  };
}
