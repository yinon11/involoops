import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getDefaultTemplate } from "@/features/generator/actions/template-actions";
import { getCustomers } from "@/features/generator/actions/customer-actions";
import { previewNextDocumentNumber } from "@/features/generator/actions/document-number-actions";
import {
  getConversionSourcePrefill,
  getReceiptParentPrefill,
} from "@/features/generator/actions/outbound-invoice-actions";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import {
  buildIssuerIdentityFromEntity,
  MissingIssuerIdentityError,
  type IssuerIdentity,
} from "@/lib/documents/issuer-identity";
import { CreateInvoiceForm } from "@/features/generator/components/outbound/create-invoice-form";
import { formatDocumentNumber } from "@/lib/documents/format-number";
import { getPreviewRatesToIls } from "@/lib/fx/usd-ils-rate";
import type { TemplateConfig } from "@/types/template";
import { resolveTemplateLogo } from "@/lib/templates/logo";
import { buildTemplateConfig } from "@/lib/templates/business-config";
import type { DocumentType } from "@/lib/documents/types";

type CreateDocType =
  | "TAX_INVOICE"
  | "TAX_INVOICE_RECEIPT"
  | "RECEIPT"
  | "PROFORMA"
  | "DELIVERY_NOTE";

const SUPPORTED_CREATE_TYPES: readonly CreateDocType[] = [
  "TAX_INVOICE",
  "TAX_INVOICE_RECEIPT",
  "RECEIPT",
  "PROFORMA",
  "DELIVERY_NOTE",
];

const ALLOWED_INITIAL_TYPES = new Set<DocumentType>(SUPPORTED_CREATE_TYPES);

function resolveInitialDocType(
  raw: string | string[] | undefined,
): CreateDocType {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && ALLOWED_INITIAL_TYPES.has(v as DocumentType)) {
    return v as CreateDocType;
  }
  return "TAX_INVOICE";
}

export default async function NewOutboundInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string | string[];
    customerId?: string | string[];
    forInvoiceId?: string | string[];
    /**
     * Set when arriving from "Convert to Tax Invoice" on a PROFORMA
     * or DELIVERY_NOTE detail page. The page loads the source, locks
     * the form to TAX_INVOICE, and stamps `referencesDocumentId` on
     * submit.
     */
    fromSourceId?: string | string[];
  }>;
}) {
  const session = await requireGeneratorAccess();

  const resolvedSearch = await searchParams;
  const rawForInvoiceId = Array.isArray(resolvedSearch.forInvoiceId)
    ? resolvedSearch.forInvoiceId[0]
    : resolvedSearch.forInvoiceId;
  const rawFromSourceId = Array.isArray(resolvedSearch.fromSourceId)
    ? resolvedSearch.fromSourceId[0]
    : resolvedSearch.fromSourceId;
  // The `forInvoiceId` flow always forces RECEIPT; the `fromSourceId`
  // flow always forces TAX_INVOICE (proforma / delivery note → TI).
  // Both override any hand-typed `?type=...` so URLs that combine
  // mismatched params can't slip through.
  const initialDocumentType = rawForInvoiceId
    ? "RECEIPT"
    : rawFromSourceId
      ? "TAX_INVOICE"
      : resolveInitialDocType(resolvedSearch.type);
  const rawCustomerId = Array.isArray(resolvedSearch.customerId)
    ? resolvedSearch.customerId[0]
    : resolvedSearch.customerId;
  const businessEntity = await getBusinessEntityForUserOrNull(
    session.user.id,
  );

  // If we're being launched from "Issue Receipt for this invoice",
  // load + validate the parent up front. On any ineligibility the
  // loader throws — surface as a 404-ish notFound rather than crashing
  // the form, since the only legitimate path here is via the action
  // button on a still-payable tax invoice. The settled-invoice and
  // wrong-type cases are reachable only via stale tabs / hand-typed
  // URLs.
  let receiptParent: Awaited<ReturnType<typeof getReceiptParentPrefill>> | null =
    null;
  let receiptParentError: string | null = null;
  if (rawForInvoiceId) {
    try {
      receiptParent = await getReceiptParentPrefill(rawForInvoiceId);
    } catch (err) {
      receiptParentError = err instanceof Error ? err.message : String(err);
    }
  }

  let conversionSource: Awaited<
    ReturnType<typeof getConversionSourcePrefill>
  > | null = null;
  let conversionSourceError: string | null = null;
  if (rawFromSourceId) {
    try {
      conversionSource = await getConversionSourcePrefill(rawFromSourceId);
    } catch (err) {
      conversionSourceError = err instanceof Error ? err.message : String(err);
    }
  }

  // Users who have not set up their business details yet still see
  // this page — the in-form "complete your business details" banner
  // (rendered by `CreateInvoiceForm`) blocks issuance. We avoid
  // calling `previewNextDocumentNumber` because that helper requires
  // an entity; we synthesise a placeholder preview number instead.
  // We pre-fetch the preview number for every supported document type
  // so the form can swap the "next available" hint instantly when the
  // user changes the doc-type dropdown — without that, a Receipt draft
  // would appear next to a TI-prefixed preview which is confusing.
  const fallbackPreview = (t: CreateDocType) =>
    formatDocumentNumber(t, new Date().getFullYear(), 1);
  const [template, customers, previews, ratesToIls] = await Promise.all([
    getDefaultTemplate(),
    getCustomers(),
    Promise.all(
      SUPPORTED_CREATE_TYPES.map(async (t) =>
        businessEntity
          ? (await previewNextDocumentNumber({ documentType: t }))
              .formattedNumber
          : fallbackPreview(t),
      ),
    ),
    // The Bank-of-Israel rate per issuing currency, passed to the client
    // form so the live preview shows the real statutory ILS totals the
    // moment the user picks a currency — the form can't read the server's
    // FX cache itself.
    getPreviewRatesToIls(),
  ]);
  const previewByDocType = Object.fromEntries(
    SUPPORTED_CREATE_TYPES.map((t, i) => [t, previews[i]]),
  ) as Record<CreateDocType, string>;

  // Draft render reads live identity from the business entity. If
  // the entity is null (first-time user) or `legalName` is missing,
  // render placeholders — the form's banner blocks submission, so we
  // don't want to crash the preview page.
  let issuer: IssuerIdentity;
  if (!businessEntity) {
    issuer = { name: "", taxId: null, address: "" };
  } else {
    try {
      issuer = buildIssuerIdentityFromEntity(businessEntity);
    } catch (err) {
      if (!(err instanceof MissingIssuerIdentityError)) throw err;
      issuer = { name: "", taxId: null, address: "" };
    }
  }

  const resolvedLogoUrl = await resolveTemplateLogo(template?.logoUrl ?? null);

  const config: TemplateConfig = buildTemplateConfig({
    template,
    issuer,
    logoUrl: resolvedLogoUrl,
  });

  // Source-document or receipt-parent customers always win over the
  // free-form `?customerId=` hint — the resulting document has to
  // address the same customer the source was issued to.
  const resolvedInitialCustomerId =
    receiptParent?.customerId ??
    conversionSource?.customerId ??
    (rawCustomerId && customers.some((c) => c.id === rawCustomerId)
      ? rawCustomerId
      : undefined);

  return (
    <CreateInvoiceForm
      // The receipt, conversion and blank flows all live at this one
      // route, and Next.js keeps a client component mounted across
      // same-route navigations — so without this key, leaving "Issue
      // Receipt for invoice N" for a blank form carried the receipt's
      // state along: the "payment for invoice N" line and, worse, the
      // forced 0% VAT, which once produced a plain zero-VAT tax invoice
      // nobody asked for. Remount whenever the entry mode changes.
      key={`${rawForInvoiceId ?? ""}:${rawFromSourceId ?? ""}:${initialDocumentType}:${resolvedInitialCustomerId ?? ""}`}
      templateConfig={config}
      templateId={template?.id ?? null}
      customers={customers.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email ?? null,
        address: c.address ?? null,
        taxId: c.taxId ?? null,
      }))}
      previewByDocType={previewByDocType}
      ratesToIls={ratesToIls}
      businessEntity={{
        legalName: businessEntity?.legalName ?? "",
        entityType: businessEntity?.entityType ?? "OSEK_MURSHE",
        osekMurshe: businessEntity?.osekMurshe ?? null,
        address: businessEntity?.address ?? null,
        defaultVatInclusive: businessEntity?.defaultVatInclusive ?? true,
      }}
      hasWithholdingCertificate={Boolean(businessEntity?.withholdingCertificateKey)}
      initialDocumentType={initialDocumentType}
      initialCustomerId={resolvedInitialCustomerId}
      forInvoice={
        receiptParent
          ? {
              id: receiptParent.id,
              formattedNumber: receiptParent.formattedNumber,
              outstandingAmount: receiptParent.outstandingAmount,
              currency: receiptParent.currency,
            }
          : undefined
      }
      forInvoiceError={receiptParentError ?? undefined}
      forSource={
        conversionSource
          ? {
              id: conversionSource.id,
              formattedNumber: conversionSource.formattedNumber,
              sourceType: conversionSource.documentType,
              items: conversionSource.items,
              subtotal: conversionSource.subtotal,
              vatRate: conversionSource.vatRate,
              vatAmount: conversionSource.vatAmount,
              total: conversionSource.total,
              currency: conversionSource.currency,
              language: conversionSource.language,
            }
          : undefined
      }
      forSourceError={conversionSourceError ?? undefined}
    />
  );
}
