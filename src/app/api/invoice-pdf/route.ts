import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  outboundInvoices,
  invoiceTemplates,
  documentSignatures,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { CallerContext } from "@/lib/outbound/operations";
import { generateInvoicePdf } from "@/lib/pdf/generate-pdf";
import { buildPdfSignatureStamp } from "@/lib/pdf/signature-stamp";
import type {
  PdfSignatureStamp,
  PdfCreditNoteBanner,
} from "@/lib/pdf/render-invoice-html";
import { displayDocumentNumber } from "@/lib/documents/display-number";
import { uploadFile } from "@/lib/storage";
import { appendAuditEntry } from "@/lib/audit/append";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import {
  callerFromUserId,
  getOutboundInvoiceByIdOp,
  updateOutboundInvoicePdfUrlOp,
} from "@/lib/outbound/operations";
import { AuthorizationError } from "@/lib/rbac/authorize";
import {
  buildIssuerIdentityFromCanonical,
  buildIssuerIdentityFromEntity,
  type IssuerIdentity,
} from "@/lib/documents/issuer-identity";
import type { CanonicalDocument } from "@/lib/signing/canonical-document";
import type { TemplateConfig, InvoiceData } from "@/types/template";
import { withForeignExchangeDisplay } from "@/lib/outbound/foreign-exchange-display";
import { ensureFreshRateToIls } from "@/lib/fx/usd-ils-rate";
import { printedCustomerEmail } from "@/lib/outbound/printed-customer-email";
import {
  handOutStoredInvoicePdf,
  storeIssuedCopyPdf,
} from "@/lib/outbound/invoice-pdf-copy";
import { buildTemplateConfig } from "@/lib/templates/business-config";
import { resolveTemplateLogo } from "@/lib/templates/logo";
import type { OutboundLineItem } from "@/db/schema/outbound-invoices";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invoiceId = req.nextUrl.searchParams.get("id");
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoice id" }, { status: 400 });
  }

  let caller: CallerContext;
  let loaded;
  try {
    caller = await callerFromUserId(session.user.id);
    loaded = await getOutboundInvoiceByIdOp(caller, invoiceId);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  if (!loaded) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const invoice = loaded;
  const isDraft = invoice.status === "draft";
  const isVoided = invoice.status === "voided";
  const printedNumber = displayDocumentNumber(invoice);

  // The first handout of an issued document is the stored מקור file.
  // Every later one is the certified copy. Drafts have no original yet,
  // and a voided download is a marked copy that must not replace it.
  let renderAsCopy = false;
  let missingCopyKey: string | null = null;
  if (!isDraft && !isVoided) {
    const handed = await handOutStoredInvoicePdf({
      invoiceId: invoice.id,
      pdfUrl: invoice.pdfUrl,
      ownerUserId: invoice.userId,
    });
    if (handed.ok) {
      return new NextResponse(new Uint8Array(handed.buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="invoice-${printedNumber}.pdf"`,
        },
      });
    }
    if (handed.reason === "missing_copy") {
      renderAsCopy = true;
      missingCopyKey = handed.copyKey;
    }
  }

  const customer = loaded.customer;

  let template = loaded.template;
  if (!template) {
    template =
      (await db.query.invoiceTemplates.findFirst({
        where: and(
          eq(invoiceTemplates.userId, session.user.id),
          eq(invoiceTemplates.isDefault, true),
        ),
      })) ?? null;
  }

  // Issuer identity (ITA rule — חוק מע"מ §9a): read from signed
  // canonical JSON on post-issue documents so the PDF matches what
  // was signed; fall back to live business entity for drafts.
  const [signatureRow] = await db
    .select()
    .from(documentSignatures)
    .where(eq(documentSignatures.documentId, invoice.id))
    .limit(1);
  const entity = await getBusinessEntityForUserOrNull(session.user.id);
  const issuer: IssuerIdentity =
    signatureRow && signatureRow.canonicalJson
      ? buildIssuerIdentityFromCanonical(
          signatureRow.canonicalJson as CanonicalDocument,
        )
      : entity
        ? buildIssuerIdentityFromEntity(entity)
        : { name: "", taxId: null, address: "" };

  // Puppeteer renders without a session cookie, so the same-origin
  // logo proxy would 401. Inline the bytes as a data: URL instead.
  const resolvedLogoUrl = await resolveTemplateLogo(template?.logoUrl ?? null, {
    embedAsDataUrl: true,
  });

  const config: TemplateConfig = buildTemplateConfig({
    template,
    issuer,
    logoUrl: resolvedLogoUrl,
  });

  const items = (invoice.items ?? []) as OutboundLineItem[];
  const invoiceData: InvoiceData = {
    // A reserved fiscal number is not an issued number. Drafts print a
    // placeholder until the document is actually signed.
    invoiceNumber: displayDocumentNumber(invoice),
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate ?? undefined,
    customerName: customer?.name ?? "—",
    customerEmail: printedCustomerEmail(invoice.customerEmail, customer?.email),
    customerAddress: customer?.address ?? undefined,
    customerTaxId: customer?.taxId ?? undefined,
    items,
    subtotal: Number(invoice.subtotal),
    vatRate: Number(invoice.vatRate ?? 18),
    vatAmount: Number(invoice.vatAmount ?? 0),
    total: Number(invoice.total),
    currency: invoice.currency ?? "ILS",
    language: invoice.language ?? "he",
    notes: invoice.notes ?? undefined,
    allocationNumber: invoice.allocationNumber ?? null,
    issuedWithoutAllocation:
      invoice.shaamStatus === "ISSUED_WITHOUT_ALLOCATION",
    documentType: invoice.documentType,
    payments: (invoice.payments ?? []) as import("@/lib/documents/payments").PaymentEntry[],
    reverseCharge: invoice.reverseCharge,
    fxRateToIls: invoice.fxRateToIls,
    copyMarker: isDraft ? null : renderAsCopy || isVoided ? "copy" : "original",
  };
  // Load the stored Bank of Israel rate so a draft (or a document issued
  // before rates were frozen) prints real ILS totals; with none known it
  // prints none rather than invented ones.
  await ensureFreshRateToIls(invoiceData.currency);
  const invoiceForPdf = withForeignExchangeDisplay(invoiceData);

  // Only issued (and post-issue) documents get a signature footer.
  // Drafts get a diagonal watermark so the document is unmistakably
  // a preview if it leaks out of the dashboard. Signature row loaded
  // earlier (for issuer identity); re-use it here.
  let signatureStamp: PdfSignatureStamp | undefined;
  if (!isDraft && signatureRow) {
    signatureStamp = await buildPdfSignatureStamp({
      documentId: invoice.id,
      signedAt: signatureRow.signedAt,
      keyId: signatureRow.keyId,
      canonicalJsonHash: signatureRow.canonicalJsonHash,
    });
  }

  // Credit notes (Spec 06) render with a distinctive banner referencing
  // the original invoice. Pull the reference using the denormalised
  // `references_document_id` column since it covers both full-credit
  // and partial-credit links.
  let creditBanner: PdfCreditNoteBanner | undefined;
  if (invoice.documentType === "CREDIT_INVOICE" && invoice.referencesDocumentId) {
    const [original] = await db
      .select({
        formattedNumber: outboundInvoices.formattedNumber,
        invoiceDate: outboundInvoices.invoiceDate,
      })
      .from(outboundInvoices)
      .where(eq(outboundInvoices.id, invoice.referencesDocumentId))
      .limit(1);
    if (original && original.formattedNumber != null) {
      creditBanner = {
        originalFormattedNumber: original.formattedNumber,
        originalIssueDate: original.invoiceDate,
      };
    }
  }

  let pdfResult;
  try {
    pdfResult = await generateInvoicePdf(config, invoiceForPdf, {
      isDraft,
      isVoided,
      signature: signatureStamp,
      creditNote: creditBanner,
    });
  } catch (err) {
    console.error("[invoice-pdf] generation failed:", err);
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  }

  const { buffer, sha256, byteLength, padesSigned } = pdfResult;

  // A certified copy never replaces the stored original. A draft
  // preview, or an issued document whose file was never stored, is
  // written once so the next download can serve it.
  let storedKey: string | null = null;
  if (renderAsCopy && missingCopyKey) {
    storedKey = missingCopyKey;
    await uploadFile(buffer, missingCopyKey, "application/pdf");
  } else if (!isVoided) {
    storedKey = `${invoice.userId}/invoices-pdf/${printedNumber}.pdf`;
    await uploadFile(buffer, storedKey, "application/pdf");
    await updateOutboundInvoicePdfUrlOp(caller, invoiceId, storedKey);
    if (!isDraft) {
      try {
        const copy = await generateInvoicePdf(
          config,
          { ...invoiceForPdf, copyMarker: "copy" },
          {
            isDraft: false,
            isVoided: false,
            signature: signatureStamp,
            creditNote: creditBanner,
          },
        );
        await storeIssuedCopyPdf(storedKey, copy.buffer);
      } catch (err) {
        console.error("[invoice-pdf] certified copy was not stored:", err);
      }
    }
  }

  await appendAuditEntry({
    businessEntityId: invoice.businessEntityId,
    userId: invoice.userId,
    documentId: invoice.id,
    documentType: invoice.documentType,
    eventType: "PDF_GENERATED",
    // `source` distinguishes variants so SHAs are reconcilable later:
    // `on_demand_download` includes the visible hash/QR footer;
    // `archive_at_issuance` (emitted elsewhere) omits it. Both may
    // carry a PAdES-B signature — see `padesSigned`.
    eventPayload: {
      pdfUrl: storedKey,
      sha256,
      byteLength,
      formattedNumber: invoice.formattedNumber ?? printedNumber,
      isDraft,
      isVoided,
      hasSignature: Boolean(signatureStamp),
      padesSigned,
      source: "on_demand_download",
    },
    actor: {
      userId: session.user.id,
      ip: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${printedNumber}.pdf"`,
    },
  });
}
