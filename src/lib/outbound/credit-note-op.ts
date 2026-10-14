/**
 * Caller-parameterized credit-note issuance — shared by the UI action
 * (`src/actions/credit-note-actions.ts`) and the public API route
 * (`src/app/api/v1/outbound-invoices/{id}/credit-note`).
 *
 * The heavy lifting was already encapsulated in the action; this file
 * just takes `caller` explicitly instead of resolving it from the session,
 * so the API path has a clean entry point. Compliance invariants (FOR
 * UPDATE on the original, gapless sequence for CREDIT_INVOICE, Spec-04
 * signing + archive + SHAAM submission) are preserved verbatim.
 */

import { FxRateUnavailableError, resolveRateToIls } from "@/lib/fx/usd-ils-rate";
import { withForeignExchangeDisplay } from "@/lib/outbound/foreign-exchange-display";
import { mirrorIssuedIncomeForUser } from "@/lib/outbound/income-mirror";
import { createHash, sign as nodeSign } from "node:crypto";
import { israelDateString } from "@/lib/datetime/today";
import {
  assertPrintedDateFollowsSeries,
  PrintedDateOrderError,
} from "@/lib/outbound/issue-dates";
import { db } from "@/db";
import {
  outboundInvoices,
  customers,
  businessEntities,
  invoiceTemplates,
  signingKeys,
  documentSignatures,
  documentLinks,
} from "@/db/schema";
import type { OutboundLineItem } from "@/db/schema/outbound-invoices";
import { eq, and, sql } from "drizzle-orm";
import { appendAuditEntry } from "@/lib/audit/append";
import { canonicalJson } from "@/lib/audit/canonical-json";
import { getBusinessEntityForUser } from "@/lib/rbac/current-business-entity";
import { buildIssuerIdentityFromEntity } from "@/lib/documents/issuer-identity";
import { invoiceContentLimitMessage } from "@/lib/documents/invoice-limits";
import { resolveTemplateLogo } from "@/lib/templates/logo";
import { buildTemplateConfig } from "@/lib/templates/business-config";
import { requirePermission } from "@/lib/rbac/authorize";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  canIssueOutboundDocument,
  OUTBOUND_DOCUMENTS_LOCKED_MESSAGE,
} from "@/lib/outbound/ita-issuance-gate";
import {
  validateCreditNoteRequest,
  type CreditNoteValidationError,
} from "@/lib/documents/credit-notes";
import { allocateDocumentNumberTx } from "@/features/generator/actions/document-number-actions";
import { buildCanonicalDocument } from "@/lib/signing/canonical-document";
import {
  DEFAULT_HASH_ALGORITHM,
  getSigningKeyId,
  getSigningPrivateKey,
} from "@/lib/signing/key-store";
import { persistSignatureTx } from "@/lib/signing/sign";
import { archiveDocument } from "@/lib/archive/store";
import { generateInvoicePdf } from "@/lib/pdf/generate-pdf";
import { ensureCustomerCopyPdf } from "@/lib/outbound/finalize-pdf";
import { buildPdfSignatureStamp } from "@/lib/pdf/signature-stamp";
import { regenerateAndArchiveFinalPdf } from "@/lib/outbound/finalize-pdf";
import { printedCustomerEmail } from "@/lib/outbound/printed-customer-email";
import { submitDocumentToShaam } from "@/lib/shaam/submit";
import { negateMoney, formatMoney } from "@/lib/money";
import { emitEvent } from "@/lib/webhooks/emit";
import { uploadFile } from "@/lib/storage";
import type { CallerContext } from "./operations";
import {
  OutboundCustomerDailyLimitError,
  assertOutboundCustomerDailyLimitTx,
  resolveOutboundCustomerDailyLimit,
} from "@/lib/outbound/customer-daily-limit";

export interface IssueCreditNoteInput {
  originalInvoiceId: string;
  creditAmount: string;
  reason: string;
  lines?: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    vatRate: string;
  }>;
}

export type IssueCreditNoteResult =
  | {
      success: true;
      creditNoteId: string;
      formattedNumber: string;
      signedAt: Date;
    }
  | {
      success: false;
      error: string;
      code?: CreditNoteValidationError;
      /**
       * Set when the per-customer daily cap blocked this credit note, so
       * the REST layer can answer 429 rather than a generic 500. Mirrors
       * `IssueFailure.customerDailyLimit` on the normal issue path.
       */
      customerDailyLimit?: { limit: number; issuedToday: number };
      /** Set when creation is closed pending ITA software approval. */
      documentsLocked?: true;
      /** Printed date would precede the previous document in this series. */
      dateOrder?: true;
    };

export class CreditNoteError extends Error {
  code?: CreditNoteValidationError;
  constructor(message: string, code?: CreditNoteValidationError) {
    super(message);
    this.code = code;
  }
}

export async function issueCreditNoteOp(
  caller: CallerContext,
  params: IssueCreditNoteInput,
): Promise<IssueCreditNoteResult> {
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_VOID,
    route: "issueCreditNoteOp",
  });

  const contentLimit = invoiceContentLimitMessage({ items: params.lines });
  if (contentLimit) return { success: false, error: contentLimit };

  if (!(await canIssueOutboundDocument(caller.userId))) {
    return {
      success: false,
      error: OUTBOUND_DOCUMENTS_LOCKED_MESSAGE,
      documentsLocked: true,
    };
  }

  const customerDailyLimit = await resolveOutboundCustomerDailyLimit(
    caller.businessEntityId,
  );

  // Foreign currency: a credit reverses the original's ILS amounts, so it
  // takes the rate frozen on the original. An original issued before rates
  // were frozen has none — the credit then freezes today's. Resolved before
  // the transaction: it may call the Bank of Israel.
  const [originalFx] = await db
    .select({
      currency: outboundInvoices.currency,
      fxRateToIls: outboundInvoices.fxRateToIls,
      fxRateSource: outboundInvoices.fxRateSource,
      fxRateFetchedAt: outboundInvoices.fxRateFetchedAt,
      fxRatePublishedAt: outboundInvoices.fxRatePublishedAt,
    })
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, params.originalInvoiceId))
    .limit(1);
  const creditCurrency = (originalFx?.currency ?? "ILS").toUpperCase();
  let creditFx: {
    fxRateToIls?: string | null;
    fxRateSource?: string | null;
    fxRateFetchedAt?: Date | null;
    fxRatePublishedAt?: Date | null;
  } = {};
  if (originalFx && creditCurrency !== "ILS" && creditCurrency !== "NIS") {
    if (originalFx.fxRateToIls != null) {
      creditFx = {
        fxRateToIls: originalFx.fxRateToIls,
        fxRateSource: originalFx.fxRateSource,
        fxRateFetchedAt: originalFx.fxRateFetchedAt,
        fxRatePublishedAt: originalFx.fxRatePublishedAt,
      };
    } else {
      try {
        const fx = await resolveRateToIls(creditCurrency);
        creditFx = {
          fxRateToIls: String(fx.rate),
          fxRateSource: fx.source,
          fxRateFetchedAt: fx.fetchedAt,
          fxRatePublishedAt: fx.publishedAt,
        };
      } catch (err) {
        if (err instanceof FxRateUnavailableError) {
          return { success: false, error: err.message };
        }
        throw err;
      }
    }
  }

  try {
    const out = await db.transaction(async (tx) => {
      const lockedRows = await tx.execute<{
        id: string;
        business_entity_id: string;
        document_type: string;
        status: string;
        formatted_number: string;
        invoice_date: string;
        printed_date: string | null;
        customer_id: string | null;
        customer_email: string | null;
        template_id: string | null;
        total: string;
        net_of_credits_amount: string | null;
        currency: string | null;
      }>(sql`
        SELECT id, business_entity_id, document_type, status,
               formatted_number, invoice_date, printed_date, customer_id,
               customer_email, template_id, total,
               net_of_credits_amount, currency
        FROM outbound_invoices
        WHERE id = ${params.originalInvoiceId} AND deleted_at IS NULL
        FOR UPDATE
      `);
      const locked = lockedRows[0];
      if (!locked) throw new CreditNoteError("Invoice not found");

      const validation = validateCreditNoteRequest({
        original: {
          id: locked.id,
          businessEntityId: locked.business_entity_id,
          documentType: locked.document_type as import("@/lib/documents/types").DocumentType,
          status: locked.status,
          total: locked.total,
          netOfCreditsAmount: locked.net_of_credits_amount,
        },
        actingBusinessEntityId: caller.businessEntityId,
        creditAmount: params.creditAmount,
        reason: params.reason,
      });
      if (!validation.valid) {
        throw new CreditNoteError(validation.error, validation.error);
      }

      const [originalSignatureRow] = await tx
        .select({
          canonicalJsonHash: documentSignatures.canonicalJsonHash,
        })
        .from(documentSignatures)
        .where(eq(documentSignatures.documentId, locked.id))
        .limit(1);
      if (!originalSignatureRow) {
        throw new CreditNoteError(
          "Original invoice has no signature; refusing to credit",
        );
      }

      const reason = params.reason.trim();
      const today = new Date();
      const invoiceDateIso = israelDateString(today);
      const taxYear = Number(invoiceDateIso.slice(0, 4));

      await assertPrintedDateFollowsSeries(tx, {
        businessEntityId: caller.businessEntityId,
        documentType: "CREDIT_INVOICE",
        printedDate: invoiceDateIso,
      });

      // Credit notes count toward the per-customer daily cap like every
      // other document type, so they are bound by it too. Checked before
      // the sequence is touched, so a refusal rolls back without burning a
      // number; the `FOR UPDATE` on the customer row serialises this
      // against concurrent issues from `issueOutboundInvoiceOp`.
      await assertOutboundCustomerDailyLimitTx(tx, {
        businessEntityId: caller.businessEntityId,
        customerId: locked.customer_id,
        limit: customerDailyLimit,
      });

      const alloc = await allocateDocumentNumberTx(tx, {
        businessEntityId: caller.businessEntityId,
        userId: caller.userId,
        documentType: "CREDIT_INVOICE",
        taxYear,
      });

      const [originalVatRow] = await tx
        .select({
          vatRate: outboundInvoices.vatRate,
          reverseCharge: outboundInvoices.reverseCharge,
          reverseChargeConsentId: outboundInvoices.reverseChargeConsentId,
        })
        .from(outboundInvoices)
        .where(eq(outboundInvoices.id, locked.id))
        .limit(1);
      const vatRateStr = originalVatRow?.vatRate ?? "18";
      const vatRateNum = Number(vatRateStr);

      // `creditAmount` is the gross (VAT-inclusive) amount the caller
      // wants to credit — same semantics validation uses when comparing
      // it to the original's `total` / `net_of_credits_amount`. Derive
      // net via cent-integer math so `net + vat === gross` exactly,
      // even when the implied VAT does not divide evenly. Guard the
      // rate=0 path so we never divide by zero.
      const grossCreditCents = Math.round(Number(params.creditAmount) * 100);
      const netCreditCents =
        vatRateNum > 0
          ? Math.round(grossCreditCents / (1 + vatRateNum / 100))
          : grossCreditCents;
      const netCreditStr = (netCreditCents / 100).toFixed(2);

      const lineItems: OutboundLineItem[] = params.lines?.length
        ? params.lines.map((l) => {
            const total = Number(
              negateMoney(String(Number(l.quantity) * Number(l.unitPrice))),
            );
            return {
              description: l.description,
              quantity: Number(l.quantity),
              unitPrice: Number(negateMoney(l.unitPrice)),
              total,
            };
          })
        : [
            {
              description: syntheticDescription(
                locked.formatted_number,
                validation.linkType,
              ),
              quantity: 1,
              unitPrice: Number(negateMoney(netCreditStr)),
              total: Number(negateMoney(netCreditStr)),
            },
          ];

      const subtotal = lineItems.reduce((s, l) => s + l.total, 0);
      // For explicit `lines` callers, recompute VAT from subtotal (their
      // existing contract). For the synthesised single-line case, force
      // `total === -gross` exactly so 1-cent rounding drift cannot make
      // the credit total disagree with the requested credit amount or
      // with the `document_links.amount` row written below.
      const vatAmount = params.lines?.length
        ? Math.round(subtotal * (vatRateNum / 100) * 100) / 100
        : Math.round((-grossCreditCents - Math.round(subtotal * 100))) / 100;
      const total = params.lines?.length
        ? subtotal + vatAmount
        : -grossCreditCents / 100;

      const [creditRow] = await tx
        .insert(outboundInvoices)
        .values({
          userId: caller.userId,
          businessEntityId: caller.businessEntityId,
          customerId: locked.customer_id,
          customerEmail: locked.customer_email,
          documentType: "CREDIT_INVOICE",
          taxYear,
          sequenceNumber: alloc.sequenceNumber,
          formattedNumber: alloc.formattedNumber,
          invoiceNumber: alloc.formattedNumber,
          invoiceDate: invoiceDateIso,
          printedDate: invoiceDateIso,
          items: lineItems,
          subtotal: formatMoney(subtotal),
          vatRate: vatRateStr,
          vatAmount: formatMoney(vatAmount),
          total: formatMoney(total),
          // Crediting a reverse-charge invoice reverses a transaction the
          // buyer self-reported, so the reduction is theirs to report too:
          // the credit note carries the flag and prints the same caption.
          // Rests on the original's consent; no new signature is asked for.
          reverseCharge: originalVatRow?.reverseCharge ?? false,
          reverseChargeConsentId: originalVatRow?.reverseChargeConsentId ?? null,
          ...creditFx,
          currency: locked.currency ?? "ILS",
          language: "he",
          notes: `Credit for ${locked.formatted_number}: ${reason}`,
          referencesDocumentId: locked.id,
          status: "draft",
          // Allocated and issued inside this same transaction, so the
          // issuance stamp is simply "now" — kept in step with
          // `issueOutboundInvoiceOp` so `issued_at` means the same thing
          // for every document type. This is also what makes the credit
          // note count toward the per-customer daily cap.
          issuedAt: new Date(),
        })
        .returning();

      // Credit notes allocate at insert time (they go draft -> issued
      // inside this same transaction, never resting as a draft). The
      // schema declares these columns nullable for outbound drafts,
      // but for credit-note rows they are guaranteed non-null here.
      const creditFormattedNumber = creditRow.formattedNumber;
      const creditSequenceNumber = creditRow.sequenceNumber;
      if (creditFormattedNumber == null || creditSequenceNumber == null) {
        throw new CreditNoteError(
          "Credit-note allocation invariant violated — fiscal number missing post-insert.",
        );
      }

      await tx.insert(documentLinks).values({
        businessEntityId: caller.businessEntityId,
        fromDocumentId: creditRow.id,
        toDocumentId: locked.id,
        linkType: validation.linkType,
        amount: formatMoney(params.creditAmount),
        reason,
        createdByUserId: caller.userId,
      });

      await appendAuditEntry({
        tx,
        businessEntityId: caller.businessEntityId,
        userId: caller.userId,
        documentId: creditRow.id,
        documentType: "CREDIT_INVOICE",
        eventType: "CREATED",
        eventPayload: {
          sequenceNumber: alloc.sequenceNumber,
          formattedNumber: alloc.formattedNumber,
          documentType: "CREDIT_INVOICE",
          referencesDocumentId: locked.id,
          totalAmount: formatMoney(total),
          currency: locked.currency ?? "ILS",
          taxYear,
          creditAmount: formatMoney(params.creditAmount),
          isFullCredit: validation.linkType === "CREDIT_REVERSES",
        },
        actor: { userId: caller.userId },
      });

      const [customerRow] = creditRow.customerId
        ? await tx
            .select()
            .from(customers)
            .where(eq(customers.id, creditRow.customerId))
            .limit(1)
        : [];
      const [entityRow] = await tx
        .select()
        .from(businessEntities)
        .where(eq(businessEntities.id, creditRow.businessEntityId))
        .limit(1);
      if (!entityRow) throw new CreditNoteError("Business entity not found");
      if (entityRow.shaamSandbox) {
        await tx
          .update(outboundInvoices)
          .set({ sandboxDocument: true })
          .where(eq(outboundInvoices.id, creditRow.id));
      }

      const canonical = buildCanonicalDocument({
        invoice: {
          id: creditRow.id,
          documentType: creditRow.documentType,
          formattedNumber: creditFormattedNumber,
          sequenceNumber: creditSequenceNumber,
          taxYear: creditRow.taxYear,
          invoiceDate: creditRow.invoiceDate,
          items: creditRow.items,
          subtotal: creditRow.subtotal,
          vatRate: creditRow.vatRate,
          vatAmount: creditRow.vatAmount,
          total: creditRow.total,
          currency: creditRow.currency,
          userId: creditRow.userId,
          createdAt: creditRow.createdAt,
          reverseCharge: creditRow.reverseCharge,
        },
        businessEntity: {
          id: entityRow.id,
          legalName: entityRow.legalName,
          osekMurshe: entityRow.osekMurshe,
          entityType: entityRow.entityType,
          address: entityRow.address ?? null,
        },
        customer: customerRow
          ? {
              id: customerRow.id,
              name: customerRow.name,
              taxId: customerRow.taxId ?? null,
              address: customerRow.address ?? null,
            }
          : null,
        reference: {
          documentId: locked.id,
          formattedNumber: locked.formatted_number,
          issueDate: locked.printed_date ?? locked.invoice_date,
          grandTotal: locked.total,
          canonicalJsonHash: originalSignatureRow.canonicalJsonHash,
        },
      });
      const canonicalJsonString = canonicalJson(
        canonical as unknown as Record<string, unknown>,
      );
      const canonicalJsonHash = createHash(DEFAULT_HASH_ALGORITHM)
        .update(canonicalJsonString, "utf8")
        .digest("hex");

      const keyId = getSigningKeyId();
      const [keyRow] = await tx
        .select()
        .from(signingKeys)
        .where(
          and(eq(signingKeys.keyId, keyId), eq(signingKeys.status, "ACTIVE")),
        )
        .limit(1);
      if (!keyRow) {
        throw new CreditNoteError(
          `No ACTIVE signing key for keyId=${keyId}`,
        );
      }
      const privateKey = getSigningPrivateKey();
      const signatureBase64 = nodeSign(
        DEFAULT_HASH_ALGORITHM,
        Buffer.from(canonicalJsonString, "utf8"),
        privateKey,
      ).toString("base64");
      const signedAt = new Date();

      await persistSignatureTx({
        tx,
        invoice: creditRow,
        computation: {
          canonicalDocument: canonical,
          canonicalJsonString,
          canonicalJsonHash,
          signatureBase64,
          keyId,
          algorithm: keyRow.algorithm,
        },
        actorUserId: caller.userId,
        signedAt,
      });

      // Visible signature footer + QR — see comment in
      // `issueOutboundInvoiceOp` for the symmetry; same `signedAt` /
      // `keyId` / `canonicalJsonHash` that `persistSignatureTx` just
      // wrote a few lines up.
      const creditStamp = await buildPdfSignatureStamp({
        documentId: creditRow.id,
        signedAt,
        keyId,
        canonicalJsonHash,
      });
      // A credit note must look like the document it reverses, so it
      // renders through the same template as the original invoice
      // (falling back to the tenant's default) rather than a hardcoded
      // design. Identity and contacts resolve exactly as they do on
      // every other render path — see `buildTemplateConfig`.
      const [creditTemplate] = locked.template_id
        ? await tx
            .select()
            .from(invoiceTemplates)
            .where(eq(invoiceTemplates.id, locked.template_id))
            .limit(1)
        : await tx
            .select()
            .from(invoiceTemplates)
            .where(
              and(
                eq(invoiceTemplates.userId, entityRow.ownerUserId),
                eq(invoiceTemplates.isDefault, true),
              ),
            )
            .limit(1);

      // Puppeteer has no session cookie, so the same-origin logo proxy
      // would 401 — inline the bytes as a data: URL.
      const creditLogoUrl = await resolveTemplateLogo(
        creditTemplate?.logoUrl ?? null,
        { embedAsDataUrl: true },
      );

      const { buffer: pdfBuffer } = await generateInvoicePdf(
        {
          ...buildTemplateConfig({
            template: creditTemplate,
            issuer: buildIssuerIdentityFromEntity(entityRow),
            logoUrl: creditLogoUrl,
          }),
          defaultCurrency: creditRow.currency ?? "ILS",
          defaultLanguage: creditRow.language ?? "he",
        },
        withForeignExchangeDisplay(
        {
          invoiceNumber: creditFormattedNumber,
          invoiceDate: creditRow.invoiceDate,
          sandbox: entityRow.shaamSandbox,
          dueDate: creditRow.dueDate ?? undefined,
          customerName: customerRow?.name ?? "—",
          customerEmail: printedCustomerEmail(
            creditRow.customerEmail,
            customerRow?.email,
          ),
          customerAddress: customerRow?.address ?? undefined,
          customerTaxId: customerRow?.taxId ?? undefined,
          items: lineItems,
          subtotal: Number(creditRow.subtotal),
          vatRate: Number(creditRow.vatRate ?? 18),
          vatAmount: Number(creditRow.vatAmount ?? 0),
          total: Number(creditRow.total),
          currency: creditRow.currency ?? "ILS",
          language: creditRow.language ?? "he",
          notes: creditRow.notes ?? undefined,
          reverseCharge: creditRow.reverseCharge,
          fxRateToIls: creditRow.fxRateToIls,
          copyMarker: "original",
        }),
        { isDraft: false, signature: creditStamp },
      );

      await archiveDocument({
        tx,
        document: {
          id: creditRow.id,
          businessEntityId: creditRow.businessEntityId,
          userId: caller.userId,
          documentType: "CREDIT_INVOICE",
          formattedNumber: creditFormattedNumber,
          taxYear,
        },
        canonicalDocument: canonical,
        canonicalJsonString,
        signature: {
          keyId,
          algorithm: keyRow.algorithm,
          signatureBase64,
          signedAt,
          canonicalJsonHash,
        },
        pdfBuffer,
        actorUserId: caller.userId,
      });

      const newRemaining = validation.remainingAfter;
      const isFullCredit = validation.linkType === "CREDIT_REVERSES";
      await tx
        .update(outboundInvoices)
        .set({
          netOfCreditsAmount: newRemaining,
          ...(isFullCredit ? { status: "voided" as const } : {}),
          version: sql`${outboundInvoices.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(outboundInvoices.id, locked.id));

      if (isFullCredit) {
        await appendAuditEntry({
          tx,
          businessEntityId: caller.businessEntityId,
          userId: caller.userId,
          documentId: locked.id,
          documentType: locked.document_type as import("@/lib/documents/types").DocumentType,
          eventType: "VOIDED",
          eventPayload: {
            reason: "fully_credited",
            creditNoteId: creditRow.id,
            creditNoteFormattedNumber: creditRow.formattedNumber,
          },
          actor: { userId: caller.userId },
        });
      }

      await appendAuditEntry({
        tx,
        businessEntityId: caller.businessEntityId,
        userId: caller.userId,
        documentId: locked.id,
        documentType: locked.document_type as import("@/lib/documents/types").DocumentType,
        eventType: "CREDIT_NOTE_ISSUED",
        eventPayload: {
          creditNoteId: creditRow.id,
          creditNoteFormattedNumber: creditRow.formattedNumber,
          amount: formatMoney(params.creditAmount),
          reason,
          isFullCredit,
          remainingAfter: newRemaining,
        },
        actor: { userId: caller.userId },
      });

      return {
        creditNoteId: creditRow.id,
        formattedNumber: creditFormattedNumber,
        originalId: locked.id,
        originalVoided: isFullCredit,
        signedAt,
        pdfBuffer,
      };
    });

    // Publish the issued credit-note PDF to the operational object store
    // so `GET /api/v1/outbound-invoices/{id}/pdf` works immediately. Same
    // key shape as outbound issuance — overwritten if SHAAM later approves
    // and we re-archive a final PDF with the allocation number.
    try {
      const opKey = `${caller.userId}/invoices-pdf/${out.formattedNumber}.pdf`;
      await uploadFile(out.pdfBuffer, opKey, "application/pdf");
      await db
        .update(outboundInvoices)
        .set({
          pdfUrl: opKey,
          version: sql`${outboundInvoices.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(outboundInvoices.id, out.creditNoteId));
    } catch (publishErr) {
      console.error(
        `[issue] credit-note publishIssuedPdf failed for ${out.creditNoteId}:`,
        publishErr,
      );
    }

    try {
      await ensureCustomerCopyPdf(out.creditNoteId);
    } catch (copyErr) {
      console.error(
        `[issue] credit-note certified copy failed for ${out.creditNoteId}:`,
        copyErr,
      );
    }

    // SHAAM submission outside the tx — same pattern as issueOutboundInvoiceOp.
    try {
      const shaamResult = await submitDocumentToShaam({
        documentId: out.creditNoteId,
        actorUserId: caller.userId,
        actionCode: 1,
      });
      // Same rule as `issueOutboundInvoiceOp`: APPROVED and NOT_REQUIRED
      // are final PDFs. NOT_REQUIRED has no allocation number, so it must
      // not wait on the allocation re-archive below — that branch never
      // runs for under-threshold credit notes, and the column default is
      // `interim`.
      const pdfKind =
        shaamResult.shaamStatus === "APPROVED" ||
        shaamResult.shaamStatus === "NOT_REQUIRED"
          ? "final"
          : "interim";

      if (
        shaamResult.shaamStatus === "APPROVED" &&
        shaamResult.allocationNumber
      ) {
        // Sandbox mock and a real SHAAM approval both return APPROVED
        // with an allocation number. Re-render through the same helper
        // the retry cron uses so pdf_kind becomes `final` and the
        // customer PDF carries the allocation number.
        const finalized = await regenerateAndArchiveFinalPdf({
          invoiceId: out.creditNoteId,
          allocationNumber: shaamResult.allocationNumber,
          actorUserId: caller.userId,
        });
        if (!finalized.ok) {
          console.error(
            `[shaam] credit-note finalize failed for ${out.creditNoteId}:`,
            finalized.error,
          );
        }
      } else if (pdfKind === "final") {
        await db
          .update(outboundInvoices)
          .set({
            pdfKind: "final",
            updatedAt: new Date(),
          })
          .where(eq(outboundInvoices.id, out.creditNoteId));
      } else if (shaamResult.shaamStatus === "REJECTED") {
        // A refusal cannot block a credit note the way it blocks an
        // invoice. The credit note is committed inside the transaction
        // above because it reverses a document that is already issued —
        // refusing to record the reversal would leave the books wrong,
        // and there is no draft left to send back to the seller.
        //
        // So there is no choice to offer here; the outcome is the same
        // one the invoice dialog calls "issue without an allocation
        // number", and it is recorded as such rather than left looking
        // like a failure the seller could still act on. Without this the
        // row sat at REJECTED with an `interim` PDF forever, implying a
        // retry cron would eventually finalise it. Nothing would: a
        // terminal refusal means no number is ever coming.
        const now = new Date();
        await db.transaction(async (tx) => {
          await tx
            .update(outboundInvoices)
            .set({
              shaamStatus: "ISSUED_WITHOUT_ALLOCATION",
              shaamRejectionChoice: "issue_without_allocation",
              shaamRejectionChoiceAt: now,
              shaamRejectionChoiceBy: caller.userId,
              pdfKind: "final",
              updatedAt: now,
            })
            .where(eq(outboundInvoices.id, out.creditNoteId));
          await appendAuditEntry({
            tx,
            businessEntityId: caller.businessEntityId,
            userId: caller.userId,
            documentId: out.creditNoteId,
            documentType: "CREDIT_INVOICE",
            eventType: "SHAAM_REJECTION_RESOLVED",
            eventPayload: {
              choice: "issue_without_allocation",
              // Distinguishes this from the invoice path, where a person
              // picked the option out of the dialog.
              automatic: true,
              reason: "credit_note_cannot_be_blocked",
              refusedStatus: "REJECTED",
              buyerCannotDeductVat: true,
            },
            actor: { userId: caller.userId },
          });
        });
      }
    } catch (shaamErr) {
      console.error(
        `[shaam] credit-note submitDocumentToShaam failed for ${out.creditNoteId}:`,
        shaamErr,
      );
    }

    void emitEvent({
      userId: caller.userId,
      eventType: "outbound_invoice.credit_note_issued",
      data: {
        credit_note: {
          id: out.creditNoteId,
          formatted_number: out.formattedNumber,
          references_document_id: out.originalId,
        },
      },
    });
    if (out.originalVoided) {
      void emitEvent({
        userId: caller.userId,
        eventType: "outbound_invoice.voided",
        data: {
          outbound_invoice: {
            id: out.originalId,
            status: "voided",
            reason: "fully_credited",
            credit_note_id: out.creditNoteId,
          },
        },
      });
    }

    try {
      await mirrorIssuedIncomeForUser(caller.userId);
    } catch (mirrorErr) {
      console.error(
        `[credit] income mirror failed for ${out.creditNoteId}:`,
        mirrorErr,
      );
    }

    return { success: true, ...out };
  } catch (err) {
    if (err instanceof CreditNoteError) {
      return { success: false, error: err.message, code: err.code };
    }
    if (err instanceof PrintedDateOrderError) {
      return { success: false, error: err.message, dateOrder: true };
    }
    if (err instanceof OutboundCustomerDailyLimitError) {
      return {
        success: false,
        error: err.message,
        customerDailyLimit: { limit: err.limit, issuedToday: err.issuedToday },
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Caller helper for the action-layer shim.
export async function callerFromUserIdForCredit(
  userId: string,
): Promise<CallerContext> {
  const entity = await getBusinessEntityForUser(userId);
  return { userId, businessEntityId: entity.id };
}

function syntheticDescription(
  originalFormattedNumber: string,
  linkType: "CREDIT_REVERSES" | "CREDIT_PARTIAL",
): string {
  return linkType === "CREDIT_REVERSES"
    ? `זיכוי בגין חשבונית ${originalFormattedNumber}`
    : `זיכוי חלקי בגין חשבונית ${originalFormattedNumber}`;
}
