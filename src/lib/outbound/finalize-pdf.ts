/**
 * Spec 08+ — re-render an outbound invoice PDF with its SHAAM allocation
 * number and append a `PDF_FINAL` archive object to the per-business-entity
 * hash chain. Updates `outbound_invoices.pdfUrl` + `pdfKind = 'final'` so
 * the public REST API and `GET /api/v1/.../pdf` serve the customer-facing
 * version (the one with the allocation number printed on it).
 *
 * Used by the SHAAM retry cron and the user-facing retry actions, through
 * `finalizeAfterShaamClear` below — call that rather than this directly,
 * so every path that can turn a document APPROVED finalises it the same
 * way. (This comment claimed the retry action already did; it did not,
 * which left a manually retried invoice approved with an interim PDF and
 * no allocation number printed on it.) The Pattern C
 * inline issue path doesn't need this helper — it renders + archives the
 * final PDF directly when SHAAM approves synchronously.
 *
 * Idempotent: if `pdfKind` is already `final`, the function returns early
 * without re-rendering or re-archiving. Concurrent cron passes that race
 * each other will still produce at most one extra `PDF_FINAL` archive
 * object (the second pass's update no-ops because `pdfKind = 'final'`),
 * and the chain stays consistent because `archivePdfFinal` serialises
 * inserts on a per-entity advisory lock.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureFreshRateToIls } from "@/lib/fx/usd-ils-rate";
import {
  outboundInvoices,
  customers,
  invoiceTemplates,
  businessEntities,
} from "@/db/schema";
import { archivePdfFinal } from "@/lib/archive/store";
import { generateInvoicePdf } from "@/lib/pdf/generate-pdf";
import { loadPdfSignatureStamp } from "@/lib/pdf/signature-stamp";
import { resolveTemplateLogo } from "@/lib/templates/logo";
import { buildIssuerIdentityFromEntity } from "@/lib/documents/issuer-identity";
import { buildTemplateConfig } from "@/lib/templates/business-config";
import type { TemplateConfig, InvoiceData } from "@/types/template";
import { withForeignExchangeDisplay } from "@/lib/outbound/foreign-exchange-display";
import { printedCustomerEmail } from "@/lib/outbound/printed-customer-email";
import type { PaymentEntry } from "@/lib/documents/payments";
import { appendAuditEntry } from "@/lib/audit/append";
import { downloadFile, uploadFile } from "@/lib/storage";
import {
  issuedCopyPdfKey,
  storeIssuedCopyPdf,
} from "@/lib/outbound/invoice-pdf-copy";

export type FinalizeResult =
  | { ok: true; alreadyFinal: false; chainSequence: number; pdfKey: string }
  | { ok: true; alreadyFinal: true }
  | { ok: false; error: string };

/**
 * Re-render the PDF with `allocationNumber`, archive it as `PDF_FINAL`,
 * and flip the document to `pdf_kind = 'final'`. Safe to call multiple
 * times — the row-level guard short-circuits once finalised.
 */
export async function regenerateAndArchiveFinalPdf(params: {
  invoiceId: string;
  allocationNumber: string;
  actorUserId: string;
}): Promise<FinalizeResult> {
  const [invoice] = await db
    .select()
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, params.invoiceId))
    .limit(1);
  if (!invoice) return { ok: false, error: "Invoice not found" };
  // A document issued before rates were frozen prints at the latest stored
  // Bank of Israel rate; load it so the footer is not dropped.
  if (invoice.fxRateToIls == null) await ensureFreshRateToIls(invoice.currency);

  // Idempotent short-circuit. The cron may legitimately call this on a
  // row that was already finalised by an earlier inline path.
  if (invoice.pdfKind === "final") {
    return { ok: true, alreadyFinal: true };
  }

  // Finalisation only runs on issued documents (the cron only picks up
  // rows in PENDING/OUTAGE_ISSUED that have already gone through
  // `issueOutboundInvoiceOp`). The `outbound_invoices_issued_has_number`
  // CHECK guarantees a fiscal number exists; narrow for TypeScript.
  if (invoice.formattedNumber == null) {
    return {
      ok: false,
      error: `Invoice ${invoice.id} has no allocated fiscal number — refusing to finalize a draft.`,
    };
  }
  const invoiceFormattedNumber = invoice.formattedNumber;

  const [entity] = await db
    .select()
    .from(businessEntities)
    .where(eq(businessEntities.id, invoice.businessEntityId))
    .limit(1);
  if (!entity) return { ok: false, error: "Business entity not found" };

  const [template] = invoice.templateId
    ? await db
        .select()
        .from(invoiceTemplates)
        .where(eq(invoiceTemplates.id, invoice.templateId))
        .limit(1)
    : await db
        .select()
        .from(invoiceTemplates)
        .where(eq(invoiceTemplates.userId, invoice.userId))
        .limit(1);

  const [customer] = invoice.customerId
    ? await db
        .select()
        .from(customers)
        .where(eq(customers.id, invoice.customerId))
        .limit(1)
    : [];

  const issuer = buildIssuerIdentityFromEntity({
    legalName: entity.legalName,
    osekMurshe: entity.osekMurshe,
    address: entity.address ?? null,
  });

  const resolvedLogoUrl = await resolveTemplateLogo(template?.logoUrl ?? null, {
    embedAsDataUrl: true,
  });

  const config: TemplateConfig = buildTemplateConfig({
    template,
    issuer,
    logoUrl: resolvedLogoUrl,
  });

  const data: InvoiceData = {
    invoiceNumber: invoiceFormattedNumber,
    invoiceDate: invoice.printedDate ?? invoice.invoiceDate,
    valueDate:
      invoice.printedDate && invoice.printedDate !== invoice.invoiceDate
        ? invoice.invoiceDate
        : undefined,
    dueDate: invoice.dueDate ?? undefined,
    customerName: customer?.name ?? "—",
    customerEmail: printedCustomerEmail(invoice.customerEmail, customer?.email),
    customerAddress: customer?.address ?? undefined,
    customerTaxId: customer?.taxId ?? undefined,
    items: invoice.items,
    subtotal: Number(invoice.subtotal),
    vatRate: Number(invoice.vatRate ?? 18),
    vatAmount: Number(invoice.vatAmount ?? 0),
    total: Number(invoice.total),
    currency: invoice.currency ?? "ILS",
    language: invoice.language ?? "he",
    notes: invoice.notes ?? undefined,
    documentType: invoice.documentType,
    allocationNumber: params.allocationNumber,
    issuedWithoutAllocation:
      invoice.shaamStatus === "ISSUED_WITHOUT_ALLOCATION",
    sandbox: entity.shaamSandbox,
    payments: (invoice.payments ?? []) as PaymentEntry[],
    reverseCharge: invoice.reverseCharge,
    fxRateToIls: invoice.fxRateToIls,
    copyMarker: "original",
  };

  // Re-render with the visible signature footer + QR. The signature
  // row was written at issue time, so the lookup should always hit;
  // miss is treated as a non-fatal degradation (footerless final PDF)
  // because the cron should still publish the allocation-number-stamped
  // bytes even if the signature row is unexpectedly absent.
  const finalizeStamp = await loadPdfSignatureStamp(invoice.id);
  let pdfBuffer: Buffer;
  try {
    const { buffer } = await generateInvoicePdf(
      config,
      withForeignExchangeDisplay(data),
      {
        isDraft: false,
        signature: finalizeStamp ?? undefined,
      },
    );
    pdfBuffer = buffer;
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Final PDF render failed: ${err.message}`
          : "Final PDF render failed",
    };
  }

  let copyBuffer: Buffer | null = null;
  try {
    const copy = await generateInvoicePdf(
      config,
      { ...data, copyMarker: "copy" },
      { isDraft: false, signature: finalizeStamp ?? undefined },
    );
    copyBuffer = copy.buffer;
  } catch (err) {
    console.error(
      `[finalize] certified copy render failed for ${invoice.id}:`,
      err,
    );
  }

  let archived: { chainSequence: number; key: string; versionId: string };
  try {
    archived = await archivePdfFinal({
      document: {
        id: invoice.id,
        businessEntityId: invoice.businessEntityId,
        userId: invoice.userId,
        documentType: invoice.documentType,
        formattedNumber: invoiceFormattedNumber,
        taxYear: invoice.taxYear,
      },
      pdfBuffer,
      actorUserId: params.actorUserId,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `archivePdfFinal failed: ${err.message}`
          : "archivePdfFinal failed",
    };
  }

  // Overwrite the operational PDF that the public `/pdf` endpoint serves
  // — same key shape as `publishIssuedPdf` in operations.ts so the
  // customer-facing download flips to the with-allocation-number version
  // the moment SHAAM clears. Failure here is logged but doesn't roll back
  // the archive; the next cron pass will retry the publish via the
  // pdfKind='final' short-circuit being false (we set it below only after
  // the publish succeeds, so a publish failure stays at 'interim').
  const operationalKey = `${invoice.userId}/invoices-pdf/${invoiceFormattedNumber}.pdf`;
  try {
    await uploadFile(pdfBuffer, operationalKey, "application/pdf");
    if (copyBuffer) await storeIssuedCopyPdf(operationalKey, copyBuffer);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `publishIssuedPdf failed: ${err.message}`
          : "publishIssuedPdf failed",
    };
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(outboundInvoices)
      .set({
        pdfUrl: operationalKey,
        pdfKind: "final",
        // The stamped file is a new original. The next handout is מקור.
        originalReleasedAt: null,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: now,
      })
      .where(eq(outboundInvoices.id, invoice.id));

    await appendAuditEntry({
      tx,
      businessEntityId: invoice.businessEntityId,
      userId: invoice.userId,
      documentId: invoice.id,
      documentType: invoice.documentType,
      eventType: "ARCHIVED",
      eventPayload: {
        kind: "PDF_FINAL_REGENERATED",
        allocationNumber: params.allocationNumber,
        chainSequence: archived.chainSequence,
        s3Key: archived.key,
        s3VersionId: archived.versionId,
        operationalKey,
      },
      actor: { userId: params.actorUserId },
    });
  });

  return {
    ok: true,
    alreadyFinal: false,
    chainSequence: archived.chainSequence,
    pdfKey: operationalKey,
  };
}


/**
 * Finalise a document if, and only if, a SHAAM call just gave it an
 * allocation number.
 *
 * Every path that can flip a document to APPROVED has to do this, and
 * until now only the cron did. `retrySubmission` and `offerReverseCharge`
 * — both reachable from a button on the invoice page — called
 * `submitDocumentToShaam` and stopped there, so a seller who retried and
 * was approved got:
 *
 *   shaam_status = APPROVED, allocation_number set,
 *   pdf_kind     = 'interim', no PDF_FINAL archive object,
 *   and a customer-facing PDF with no allocation number on it.
 *
 * Which is both a half-state and non-compliant: the number has to appear
 * on the invoice. `scripts/verify-document.ts` reports exactly this.
 *
 * Returns null when there was nothing to finalise, so callers can tell
 * "not approved" from "approved and finalising failed".
 */
export async function finalizeAfterShaamClear(params: {
  invoiceId: string;
  actorUserId: string;
  shaamStatus: string;
  allocationNumber: string | null;
}): Promise<FinalizeResult | null> {
  if (params.shaamStatus !== "APPROVED" || !params.allocationNumber) {
    return null;
  }
  return regenerateAndArchiveFinalPdf({
    invoiceId: params.invoiceId,
    allocationNumber: params.allocationNumber,
    actorUserId: params.actorUserId,
  });
}

/**
 * The certified-copy file for an issued document. Renders and stores it
 * when an older document was issued before copies were kept. Does not
 * replace the מקור file and does not count as handing that original out.
 */
export async function ensureCustomerCopyPdf(
  invoiceId: string,
): Promise<Buffer | null> {
  const [invoice] = await db
    .select()
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, invoiceId))
    .limit(1);
  if (!invoice?.formattedNumber || !invoice.pdfUrl) return null;
  const originalKey = `${invoice.userId}/invoices-pdf/${invoice.formattedNumber}.pdf`;
  const copyKey = issuedCopyPdfKey(originalKey);
  try {
    return await downloadFile(copyKey);
  } catch {
    // Stored copy is missing — render one below.
  }

  if (invoice.fxRateToIls == null) await ensureFreshRateToIls(invoice.currency);
  const [entity] = await db
    .select()
    .from(businessEntities)
    .where(eq(businessEntities.id, invoice.businessEntityId))
    .limit(1);
  if (!entity) return null;
  const [template] = invoice.templateId
    ? await db
        .select()
        .from(invoiceTemplates)
        .where(eq(invoiceTemplates.id, invoice.templateId))
        .limit(1)
    : await db
        .select()
        .from(invoiceTemplates)
        .where(eq(invoiceTemplates.userId, invoice.userId))
        .limit(1);
  const [customer] = invoice.customerId
    ? await db
        .select()
        .from(customers)
        .where(eq(customers.id, invoice.customerId))
        .limit(1)
    : [];
  const resolvedLogoUrl = await resolveTemplateLogo(template?.logoUrl ?? null, {
    embedAsDataUrl: true,
  });
  const config: TemplateConfig = buildTemplateConfig({
    template,
    issuer: buildIssuerIdentityFromEntity({
      legalName: entity.legalName,
      osekMurshe: entity.osekMurshe,
      address: entity.address ?? null,
    }),
    logoUrl: resolvedLogoUrl,
  });
  const data: InvoiceData = {
    invoiceNumber: invoice.formattedNumber,
    invoiceDate: invoice.printedDate ?? invoice.invoiceDate,
    valueDate:
      invoice.printedDate && invoice.printedDate !== invoice.invoiceDate
        ? invoice.invoiceDate
        : undefined,
    dueDate: invoice.dueDate ?? undefined,
    customerName: customer?.name ?? "—",
    customerEmail: printedCustomerEmail(invoice.customerEmail, customer?.email),
    customerAddress: customer?.address ?? undefined,
    customerTaxId: customer?.taxId ?? undefined,
    items: invoice.items,
    subtotal: Number(invoice.subtotal),
    vatRate: Number(invoice.vatRate ?? 18),
    vatAmount: Number(invoice.vatAmount ?? 0),
    total: Number(invoice.total),
    currency: invoice.currency ?? "ILS",
    language: invoice.language ?? "he",
    notes: invoice.notes ?? undefined,
    documentType: invoice.documentType,
    allocationNumber: invoice.allocationNumber,
    issuedWithoutAllocation:
      invoice.shaamStatus === "ISSUED_WITHOUT_ALLOCATION",
    sandbox: entity.shaamSandbox,
    payments: (invoice.payments ?? []) as PaymentEntry[],
    reverseCharge: invoice.reverseCharge,
    fxRateToIls: invoice.fxRateToIls,
    copyMarker: "copy",
  };
  try {
    const stamp = await loadPdfSignatureStamp(invoice.id);
    const { buffer } = await generateInvoicePdf(
      config,
      withForeignExchangeDisplay(data),
      { isDraft: false, signature: stamp ?? undefined },
    );
    await uploadFile(buffer, copyKey, "application/pdf");
    return buffer;
  } catch (err) {
    console.error(
      `[invoice-pdf] certified copy render failed for ${invoiceId}:`,
      err,
    );
    return null;
  }
}
