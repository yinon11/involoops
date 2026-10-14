import { readClock } from "@/lib/clock";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getOutboundInvoiceById } from "@/features/generator/actions/outbound-invoice-actions";
import { listDocumentTimeline } from "@/actions/audit-actions";
import { getDefaultTemplate } from "@/features/generator/actions/template-actions";
import { resolveTemplateLogo } from "@/lib/templates/logo";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { format } from "@/lib/i18n/format";
import { todayInIsrael } from "@/lib/datetime/today";
import { isWithholdingCertificateExpired } from "@/lib/documents/withholding-certificate";
import { requiresAllocation } from "@/lib/shaam/thresholds";
import { allocationAmountsIls } from "@/lib/shaam/allocation-amounts";
import { MissingExchangeRateError } from "@/lib/outbound/statutory-ils-amounts";
import {
  customerTaxIdBlocksIssue,
  isAllocatableCustomerTaxId,
} from "@/lib/shaam/customer-tax-id";
import {
  latestConsentFor,
  sellerAcknowledgementText,
} from "@/lib/outbound/reverse-charge-consent";
import {
  REVERSE_CHARGE_DOCUMENT_TYPES,
  findActiveReplacement,
} from "@/lib/outbound/reverse-charge";
import { STATUTORY_VAT_RATE } from "@/lib/documents/vat";
import { compareMoney } from "@/lib/money";
import { assessCashCeiling } from "@/lib/documents/cash-ceiling";
import {
  ReverseChargePanel,
  type ReverseChargeConsentSummary,
} from "@/features/generator/components/outbound/reverse-charge-panel";
import { hasActiveAuthorization } from "@/lib/shaam/authorization";
import { HELD_MAX_AGE_MS } from "@/lib/shaam/reconcile-scan";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import {
  buildIssuerIdentityFromCanonical,
  buildIssuerIdentityFromEntity,
  type IssuerIdentity,
} from "@/lib/documents/issuer-identity";
import type { CanonicalDocument } from "@/lib/signing/canonical-document";
import { buildPdfSignatureStamp } from "@/lib/pdf/signature-stamp";
import { db } from "@/db";
import {
  documentSignatures,
  documentLinks,
  outboundInvoices,
} from "@/db/schema";
import { InvoiceViewClient } from "@/features/generator/components/outbound/invoice-view-client";
import { InvoiceAuditTimeline } from "@/features/generator/components/outbound/invoice-audit-timeline";
import { CreditNoteBanner } from "@/features/generator/components/outbound/credit-note-banner";
import { authorize } from "@/lib/rbac/authorize";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  CreditHistoryCard,
  type CreditHistoryEntry,
} from "@/features/generator/components/outbound/credit-history-card";
import { ReceiptHistoryCard } from "@/features/generator/components/outbound/receipt-history-card";
import type { OutboundInvoiceStatus } from "@/db/schema/outbound-invoices";
import type { TemplateConfig, InvoiceData } from "@/types/template";
import { withForeignExchangeDisplay } from "@/lib/outbound/foreign-exchange-display";
import { ensureFreshRateToIls } from "@/lib/fx/usd-ils-rate";
import { displayDocumentNumber } from "@/lib/documents/display-number";
import { findVoluntaryAllocationRefusal } from "@/lib/outbound/operations";
import { printedCustomerEmail } from "@/lib/outbound/printed-customer-email";
import { buildTemplateConfig } from "@/lib/templates/business-config";
import type { OutboundLineItem } from "@/db/schema/outbound-invoices";

export default async function OutboundInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireGeneratorAccess();

  const { id } = await params;
  const data = await getOutboundInvoiceById(id);
  if (!data) notFound();

  const voluntaryRefusal =
    (data.status ?? "draft") === "draft" &&
    data.formattedNumber &&
    data.shaamStatus === "NOT_REQUIRED"
      ? await findVoluntaryAllocationRefusal(data.id)
      : null;

  const template = data.template ?? (await getDefaultTemplate());

  const items = (data.items ?? []) as OutboundLineItem[];

  const invoice: InvoiceData = {
    // A number may already be reserved (a Tax Authority request that the
    // seller then declined to issue). It is not printed until issue.
    invoiceNumber: displayDocumentNumber(data),
    invoiceDate: data.printedDate ?? data.invoiceDate,
    valueDate:
      data.printedDate && data.printedDate !== data.invoiceDate
        ? data.invoiceDate
        : undefined,
    dueDate: data.dueDate ?? undefined,
    customerName: data.customer?.name ?? "—",
    customerEmail: printedCustomerEmail(data.customerEmail, data.customer?.email),
    customerAddress: data.customer?.address ?? undefined,
    customerTaxId: data.customer?.taxId ?? undefined,
    items,
    subtotal: Number(data.subtotal),
    vatRate: Number(data.vatRate ?? 18),
    vatAmount: Number(data.vatAmount ?? 0),
    total: Number(data.total),
    currency: data.currency ?? "ILS",
    language: data.language ?? "he",
    notes: data.notes ?? undefined,
    documentType: data.documentType,
    allocationNumber: data.allocationNumber ?? null,
    payments: (data.payments ?? []) as import("@/lib/documents/payments").PaymentEntry[],
    // Same mark as the file a download would hand out now. Drafts have
    // none. Once the מקור has gone out, the screen shows the certified copy.
    reverseCharge: data.reverseCharge,
    issuedWithoutAllocation: data.shaamStatus === "ISSUED_WITHOUT_ALLOCATION",
    fxRateToIls: data.fxRateToIls,
    copyMarker:
      data.status === "draft"
        ? null
        : data.status === "voided" || data.originalReleasedAt
          ? "copy"
          : "original",
  };
  // Foreign-currency documents print statutory ILS totals at the Bank of
  // Israel rate: an issued one at its frozen rate, a draft at the latest
  // stored one, loaded here before the (synchronous) FX display is built.
  // With no rate known, no ILS figures are shown — never a fixed rate.
  await ensureFreshRateToIls(invoice.currency);
  const invoiceForDisplay = withForeignExchangeDisplay(invoice);

  const isCreditNote = data.documentType === "CREDIT_INVOICE";
  const remainingBalance = Number(data.netOfCreditsAmount ?? data.total);
  const isCreditable =
    (data.documentType === "TAX_INVOICE" ||
      data.documentType === "TAX_INVOICE_RECEIPT") &&
    ["issued", "sent", "paid"].includes(data.status ?? "") &&
    remainingBalance > 0;

  // Receipts settle plain TAX_INVOICEs only (TIR is paid by
  // construction). The detail page also surfaces a "Receipts received"
  // card; we load the linked receipts here so we can both decide
  // whether to render the "Issue Receipt" button and feed the card.
  const linkedReceiptsRows =
    data.documentType === "TAX_INVOICE"
      ? await db
          .select({
            id: outboundInvoices.id,
            formattedNumber: outboundInvoices.formattedNumber,
            invoiceDate: outboundInvoices.invoiceDate,
            total: outboundInvoices.total,
            status: outboundInvoices.status,
            payments: outboundInvoices.payments,
          })
          .from(outboundInvoices)
          .where(
            and(
              eq(outboundInvoices.referencesDocumentId, data.id),
              eq(outboundInvoices.documentType, "RECEIPT"),
              isNull(outboundInvoices.deletedAt),
            ),
          )
          .orderBy(asc(outboundInvoices.invoiceDate))
      : [];
  const settledByReceipts = linkedReceiptsRows
    .filter((r) => r.status !== "voided" && r.status !== "draft")
    .reduce((sum, r) => sum + Number(r.total), 0);
  const outstandingAfterReceipts = Math.max(
    0,
    remainingBalance - settledByReceipts,
  );
  const canIssueReceipt =
    data.documentType === "TAX_INVOICE" &&
    (data.status === "issued" || data.status === "sent") &&
    outstandingAfterReceipts > 0;

  // "Convert to Tax Invoice" — surfaced on issued PROFORMA / DELIVERY_NOTE
  // detail pages. The new TI carries the source's items + customer
  // pre-filled and writes `references_document_id` back to the source
  // for traceability. We don't block re-conversion (a quote can be
  // re-quoted at a different price) but the CTA disappears once the
  // source has already been converted at least once.
  const linkedTaxInvoiceCount =
    data.documentType === "PROFORMA" || data.documentType === "DELIVERY_NOTE"
      ? (
          await db
            .select({ id: outboundInvoices.id })
            .from(outboundInvoices)
            .where(
              and(
                eq(outboundInvoices.referencesDocumentId, data.id),
                eq(outboundInvoices.documentType, "TAX_INVOICE"),
                isNull(outboundInvoices.deletedAt),
              ),
            )
        ).length
      : 0;
  const canConvertToInvoice =
    (data.documentType === "PROFORMA" ||
      data.documentType === "DELIVERY_NOTE") &&
    (data.status === "issued" || data.status === "sent") &&
    linkedTaxInvoiceCount === 0;

  const [timeline, dict, signatureRow, issuerEntity, creditParentRow, creditHistoryRows] =
    await Promise.all([
      listDocumentTimeline(data.id),
      getDictionary(),
      db
        .select({
          signedAt: documentSignatures.signedAt,
          keyId: documentSignatures.keyId,
          canonicalJsonHash: documentSignatures.canonicalJsonHash,
          canonicalJson: documentSignatures.canonicalJson,
        })
        .from(documentSignatures)
        .where(eq(documentSignatures.documentId, data.id))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      // The user owns this invoice (verified above by the data scope
      // in `getOutboundInvoiceById`), so the entity must exist by
      // the time we get here. We use the nullable variant defensively
      // to keep the type system happy when `buildIssuerIdentityFromEntity`
      // falls through to the canonical-from-signature branch for
      // post-issue documents.
      getBusinessEntityForUserOrNull(session.user.id),
      // If THIS is a credit note, load its parent for the banner.
      isCreditNote && data.referencesDocumentId
        ? db
            .select({
              id: outboundInvoices.id,
              formattedNumber: outboundInvoices.formattedNumber,
              invoiceDate: outboundInvoices.invoiceDate,
            })
            .from(outboundInvoices)
            .where(eq(outboundInvoices.id, data.referencesDocumentId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      // If THIS is a tax invoice, load its credit history.
      data.documentType === "TAX_INVOICE" ||
      data.documentType === "TAX_INVOICE_RECEIPT"
        ? db
            .select({
              creditNoteId: outboundInvoices.id,
              formattedNumber: outboundInvoices.formattedNumber,
              createdAt: documentLinks.createdAt,
              amount: documentLinks.amount,
              reason: documentLinks.reason,
              linkType: documentLinks.linkType,
            })
            .from(documentLinks)
            .innerJoin(
              outboundInvoices,
              eq(documentLinks.fromDocumentId, outboundInvoices.id),
            )
            .where(
              and(
                eq(documentLinks.toDocumentId, data.id),
                inArray(documentLinks.linkType, [
                  "CREDIT_REVERSES",
                  "CREDIT_PARTIAL",
                ]),
              ),
            )
            .orderBy(asc(documentLinks.createdAt))
        : Promise.resolve([]),
    ]);

  if (issuerEntity?.shaamSandbox) {
    invoiceForDisplay.sandbox = true;
  }

  // Build the same signature stamp the issued PDF carries so the live
  // preview mirrors what the customer downloads (signed-at, key id,
  // canonical hash short, verify URL + QR). Drafts have no signature
  // row → preview shows the renderer's draft watermark instead.
  const previewStamp = signatureRow
    ? await buildPdfSignatureStamp({
        documentId: data.id,
        signedAt: signatureRow.signedAt,
        keyId: signatureRow.keyId,
        canonicalJsonHash: signatureRow.canonicalJsonHash,
      })
    : null;
  const signature = previewStamp
    ? {
        signedAt: previewStamp.signedAt,
        keyId: previewStamp.keyId,
        canonicalJsonHashShort: previewStamp.canonicalJsonHashShort,
        verifyUrl: previewStamp.verifyUrl,
        qrDataUrl: previewStamp.qrDataUrl,
      }
    : null;

  // Issuer identity (ITA rule — חוק מע"מ §9a): read from the signed
  // canonical JSON on any post-issue document so the PDF mirrors what
  // was signed; fall back to the live business entity for drafts.
  // `issuerEntity` is null only on the (unreachable) edge case where
  // a user has an outbound invoice without a business entity — we
  // render placeholder fields rather than crash, since the document
  // either has a signature (canonical branch wins) or is a draft the
  // form's banner blocks anyway.
  const issuer: IssuerIdentity =
    signatureRow && signatureRow.canonicalJson
      ? buildIssuerIdentityFromCanonical(
          signatureRow.canonicalJson as CanonicalDocument,
        )
      : issuerEntity
        ? buildIssuerIdentityFromEntity(issuerEntity)
        : { name: "", taxId: null, address: "" };

  const resolvedLogoUrl = await resolveTemplateLogo(template?.logoUrl ?? null);

  const config: TemplateConfig = buildTemplateConfig({
    template,
    issuer,
    logoUrl: resolvedLogoUrl,
  });

  // Spec 11 §4 — evaluate ITA gate for draft issuance modal. Only
  // meaningful while status === draft; otherwise the modal isn't shown.
  let itaGate: import("@/features/generator/components/outbound/issue-confirmation-modal").ItaAuthorizationGate = {
    required: false,
  };
  // In ILS for a foreign-currency draft, at today's rate (warmed above).
  // Null when no Bank of Israel rate is known for the draft's currency: the
  // hints below are skipped, and issuing itself refuses until a rate exists.
  let draftAllocationAmounts: ReturnType<typeof allocationAmountsIls> | null = null;
  try {
    draftAllocationAmounts = allocationAmountsIls({
      documentType: data.documentType,
      currency: data.currency,
      subtotal: data.subtotal ?? "0",
      vatAmount: data.vatAmount,
      total: data.total ?? "0",
      fxRateToIls: data.fxRateToIls,
    });
  } catch (err) {
    if (!(err instanceof MissingExchangeRateError)) throw err;
  }
  if ((data.status ?? "draft") === "draft" && draftAllocationAmounts) {
    const allocation = requiresAllocation({
      issueDate: new Date(data.invoiceDate),
      preVatAmount: draftAllocationAmounts.preVatAmount,
      currency: draftAllocationAmounts.currency,
      customerIsOsekMurshe: Boolean(data.customer?.taxId),
      vatAmount: draftAllocationAmounts.vatAmount,
    });
    if (allocation.required) {
      const authorized = await hasActiveAuthorization(data.businessEntityId);
      itaGate = {
        required: true,
        authorized,
        settingsHref: "/settings/ita-integration",
      };
    }
  }

  const creditHistoryEntries: CreditHistoryEntry[] = creditHistoryRows.map(
    (r) => ({
      creditNoteId: r.creditNoteId,
      // Credit notes are issued by construction (`issueCreditNoteOp` goes
      // draft -> issued in the same transaction), so this field is
      // never NULL at runtime; keep an empty fallback to satisfy the
      // now-nullable column type.
      formattedNumber: r.formattedNumber ?? "",
      createdAt: r.createdAt,
      amount: r.amount ?? "0.00",
      reason: r.reason,
      linkType: r.linkType as "CREDIT_REVERSES" | "CREDIT_PARTIAL",
    }),
  );

  // Mirrors the refusal in `issueOutboundInvoiceOp`, so the dialog says it
  // before the click instead of after.
  const customerTaxIdBlock =
    (data.status ?? "draft") === "draft" &&
    draftAllocationAmounts &&
    customerTaxIdBlocksIssue({
      documentType: data.documentType,
      issueDate: new Date(`${todayInIsrael()}T00:00:00Z`),
      preVatAmount: draftAllocationAmounts.preVatAmount,
      vatAmount: draftAllocationAmounts.vatAmount,
      currency: draftAllocationAmounts.currency,
      customerTaxId: data.customer?.taxId ?? null,
    })
      ? {
          customerHref: data.customer?.id
            ? `/customers/${data.customer.id}`
            : null,
        }
      : null;

  // Reverse charge (route A) — tax invoices only; shown on drafts, and on
  // issued documents that went out as reverse charge.
  const showReverseCharge =
    (REVERSE_CHARGE_DOCUMENT_TYPES as readonly string[]).includes(data.documentType) &&
    ((data.status ?? "draft") === "draft" || data.reverseCharge);
  // A refusal or a hold already lists reverse charge inside "See the
  // options". The card stays off until that option is chosen; then the
  // switch is on and the buyer-signature steps need the card.
  const reverseChargeChosen =
    data.shaamStatus !== "REJECTED" && data.shaamStatus !== "HELD"
      ? true
      : data.reverseCharge;
  // Route B links both ways: the refused original and the zero-VAT invoice
  // that replaces it. The consent was signed on the original, and is shown
  // on the replacement against the replacement's own facts.
  const replacesRow = data.reverseChargeReplacesId
    ? (
        await db
          .select({ id: outboundInvoices.id, formattedNumber: outboundInvoices.formattedNumber })
          .from(outboundInvoices)
          .where(
            and(
              eq(outboundInvoices.id, data.reverseChargeReplacesId),
              eq(outboundInvoices.businessEntityId, data.businessEntityId),
            ),
          )
          .limit(1)
      )[0] ?? null
    : null;
  const replacedByRow =
    showReverseCharge && data.reverseCharge && !data.reverseChargeReplacesId
      ? await findActiveReplacement(data.id)
      : null;
  const latestConsent = showReverseCharge
    ? data.reverseChargeReplacesId
      ? await latestConsentFor(data.reverseChargeReplacesId, data.id)
      : await latestConsentFor(data.id)
    : null;
  // The reverse-charge switch is on: the draft is a reverse-charge invoice,
  // issued from the card's own step, so the header drops its issue button.
  const reverseChargeOn =
    (data.status ?? "draft") === "draft" && data.reverseCharge;
  const reverseChargeConsent: ReverseChargeConsentSummary | null = latestConsent
    ? {
        state: latestConsent.state,
        recipientEmail: latestConsent.consent.recipientEmail,
        expiresAt: latestConsent.consent.expiresAt.toISOString(),
        signerName: latestConsent.consent.signerName,
        signerRole: latestConsent.consent.signerRole,
        signedAt: latestConsent.consent.signedAt?.toISOString() ?? null,
        signerIp: latestConsent.consent.signerIp,
      }
    : null;

  // Same permission the remediation server actions enforce. Resolved here
  // rather than assumed in the client component, so the buttons and the
  // actions behind them can never disagree.
  const canRemediate = (
    await authorize({
      userId: session.user.id,
      businessEntityId: data.businessEntityId,
      permission: PERMISSIONS.DOCUMENT_ISSUE,
      route: "outbound/[id]/page",
    })
  ).allowed;

  const nowMs = (await readClock()).nowMs;
  const holdChecksStopped =
    data.shaamStatus === "HELD" &&
    data.shaamSubmittedAt != null &&
    nowMs - data.shaamSubmittedAt.getTime() >= HELD_MAX_AGE_MS;

  const storedFx = data.fxRateToIls == null ? null : Number(data.fxRateToIls);
  const cashCeiling = assessCashCeiling({
    payments: (data.payments ?? []).map((p) => ({
      method: p.method,
      amount: Number(p.amount) || 0,
    })),
    transactionTotal: Number(data.total),
    currency: data.currency ?? "ILS",
    fxRateToIls: storedFx != null && Number.isFinite(storedFx) ? storedFx : null,
    customerTaxId: data.customer?.taxId,
  });
  const cashCeilingCopy = dict.outbound.payments;
  const originalTotal = Number(data.total);
  const partiallyCredited =
    creditHistoryEntries.length > 0 &&
    remainingBalance > 0.005 &&
    originalTotal - remainingBalance > 0.005;

  return (
    <div className="space-y-6">
      {cashCeiling?.exceeded && (
        <div className="rounded-md border-2 border-amber-600 bg-amber-50 px-4 py-3 text-amber-950">
          <p className="text-sm font-bold">{cashCeilingCopy.cashCeilingWarning}</p>
          <p className="mt-1 text-xs">
            {format(cashCeilingCopy.cashCeilingDetail, {
              kind: cashCeilingCopy.cashCeilingKind[cashCeiling.counterparty],
              permitted: cashCeiling.permittedIls.toLocaleString(),
              cash: cashCeiling.cashIls.toLocaleString(),
            })}
          </p>
        </div>
      )}
      {partiallyCredited && (
        <div className="rounded-md border-2 border-amber-600 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          {format(dict.outbound.creditNote.partiallyCreditedNotice, {
            amount: `${remainingBalance.toFixed(2)} ${data.currency ?? "ILS"}`,
          })}
        </div>
      )}
      {isCreditNote && creditParentRow && (
        <CreditNoteBanner
          originalDocumentId={creditParentRow.id}
          // The parent of a credit note is always an issued document.
          originalFormattedNumber={creditParentRow.formattedNumber ?? ""}
          originalIssueDate={creditParentRow.invoiceDate}
        />
      )}
      <InvoiceViewClient
        invoiceId={data.id}
        config={config}
        invoice={invoiceForDisplay}
        status={(data.status ?? "draft") as OutboundInvoiceStatus}
        documentType={data.documentType}
        formattedNumber={
          data.formattedNumber ?? `DRAFT-${data.id.slice(0, 8)}`
        }
        signature={signature}
        canIssueCredit={isCreditable}
        canIssueReceipt={canIssueReceipt}
        canConvertToInvoice={canConvertToInvoice}
        shaamStatus={data.shaamStatus}
        shaamReview={{
          allocationNumber: data.allocationNumber,
          submittedAt: data.shaamSubmittedAt?.toISOString() ?? null,
          respondedAt: data.shaamResponseAt?.toISOString() ?? null,
          retryCount: data.shaamRetryCount,
          lastErrorCode: data.shaamLastErrorCode,
          lastErrorMessage: data.shaamLastErrorMessage,
          hearingDeadline: data.shaamHearingDeadline?.toISOString() ?? null,
          canRemediate,
          customerCanReverseCharge: isAllocatableCustomerTaxId(
            data.customer?.taxId,
          ),
          nowMs,
          holdChecksStopped,
        }}
        itaGate={itaGate}
        customerTaxIdBlock={customerTaxIdBlock}
        reverseChargeOn={reverseChargeOn}
        hasNumber={Boolean(data.formattedNumber)}
        voluntaryDeclinePending={
          voluntaryRefusal
            ? {
                code: data.shaamLastErrorCode,
                message: data.shaamLastErrorMessage,
              }
            : null
        }
        reverseChargePanel={
          showReverseCharge && reverseChargeChosen ? (
            <ReverseChargePanel
              documentId={data.id}
              isDraft={(data.status ?? "draft") === "draft"}
              reverseCharge={data.reverseCharge}
              vatIsZero={compareMoney(String(data.vatAmount ?? "0"), "0") === 0}
              customerTaxIdValid={isAllocatableCustomerTaxId(data.customer?.taxId)}
              customerEmail={data.customer?.email ?? null}
              consent={reverseChargeConsent}
              sellerAcknowledgement={sellerAcknowledgementText(
                (await getLocale()) === "en" ? "en" : "he",
              )}
              statutoryVatRate={STATUTORY_VAT_RATE}
              canManage={canRemediate}
              afterRefusal={
                data.shaamStatus === "REJECTED" || data.shaamStatus === "HELD"
              }
              replaces={
                replacesRow
                  ? { id: replacesRow.id, formattedNumber: replacesRow.formattedNumber }
                  : null
              }
              replacedBy={
                replacedByRow
                  ? { id: replacedByRow.id, formattedNumber: replacedByRow.formattedNumber }
                  : null
              }
              isInvoiceReceipt={data.documentType === "TAX_INVOICE_RECEIPT"}
              documentTypeLabel={dict.documents.type[data.documentType]}
            />
          ) : null
        }
        dateChangeNotice={
          (data.status ?? "draft") === "draft" &&
          data.invoiceDate !== todayInIsrael()
            ? format(dict.outbound.issueModal.dateChange, {
                date: todayInIsrael(),
              })
            : null
        }
        customer={
          data.customer
            ? {
                id: data.customer.id,
                name: data.customer.name,
                email: data.customer.email ?? null,
                autoSendInvoices: data.customer.autoSendInvoices ?? null,
              }
            : null
        }
        withholdingCertificate={
          issuerEntity?.withholdingCertificateKey
            ? {
                filename: issuerEntity.withholdingCertificateFilename,
                attachByDefault: issuerEntity.attachWithholdingCertificate,
                expired: isWithholdingCertificateExpired(
                  issuerEntity.withholdingCertificateValidUntil,
                  todayInIsrael(),
                ),
              }
            : null
        }
      />
      {(data.documentType === "TAX_INVOICE" ||
        data.documentType === "TAX_INVOICE_RECEIPT") && (
        <CreditHistoryCard
          entries={creditHistoryEntries}
          remainingAmount={String(data.netOfCreditsAmount ?? data.total)}
          originalTotal={String(data.total)}
          currency={data.currency ?? "ILS"}
        />
      )}
      {data.documentType === "TAX_INVOICE" && linkedReceiptsRows.length > 0 && (
        <ReceiptHistoryCard
          entries={linkedReceiptsRows.map((r) => ({
            receiptId: r.id,
            formattedNumber: r.formattedNumber,
            invoiceDate: r.invoiceDate,
            total: r.total,
            status: (r.status ?? "draft") as OutboundInvoiceStatus,
            payments:
              (r.payments ?? []) as import("@/db/schema/outbound-invoices").OutboundPaymentEntry[],
          }))}
          outstandingAmount={outstandingAfterReceipts.toFixed(2)}
          originalTotal={String(data.total)}
          currency={data.currency ?? "ILS"}
        />
      )}
      <InvoiceAuditTimeline entries={timeline} />
    </div>
  );
}

