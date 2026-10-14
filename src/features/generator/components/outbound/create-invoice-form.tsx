"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TemplatePreview } from "@/features/generator/components/templates/template-preview";
import { createOutboundInvoice } from "@/features/generator/actions/outbound-invoice-actions";
import { createCustomer, updateCustomer } from "@/features/generator/actions/customer-actions";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";
import type { DocumentType } from "@/lib/documents/types";
import type { TemplateConfig, InvoiceData, InvoiceLineItem } from "@/types/template";
import { getThresholdForDate, CUSTOMER_TAX_ID_REQUIRED_THRESHOLD } from "@/lib/shaam/thresholds";
import { withForeignExchangeDisplay } from "@/lib/outbound/foreign-exchange-display";
import { todayInIsrael } from "@/lib/datetime/today";
import { getMissingIssuerFields } from "@/lib/business-entity/identity";
import { vatRateForInclusive } from "@/lib/documents/vat";
import { PaymentsInput } from "@/features/generator/components/outbound/payments-input";
import {
  allowsPayments,
  requiresPayments,
  validatePayments,
  type PaymentEntry,
} from "@/lib/documents/payments";
import {
  MAX_INVOICE_LINES,
  MAX_INVOICE_NOTES_LENGTH,
  MAX_LINE_DESCRIPTION_LENGTH,
} from "@/lib/documents/invoice-limits";
import { Plus, Trash2, Eye, FileText, AlertTriangle, Info, Lock, Wallet } from "lucide-react";
import Link from "next/link";

/**
 * Document types the create flow currently supports. Spec 11.1 added
 * TIR + RECEIPT; the proforma + delivery-note rollout adds PROFORMA
 * and DELIVERY_NOTE so sellers can issue every non-credit document
 * from one form. Credit notes still come through their own flow
 * (Spec 06) from a parent tax invoice.
 */
const SUPPORTED_CREATE_TYPES = [
  "TAX_INVOICE",
  "TAX_INVOICE_RECEIPT",
  "RECEIPT",
  "PROFORMA",
  "DELIVERY_NOTE",
] as const satisfies readonly DocumentType[];
type CreateDocType = (typeof SUPPORTED_CREATE_TYPES)[number];

/**
 * Sentinel value used by the in-form doc-type <Select> to redirect to
 * the credit-invoice picker (`/outbound/new-credit`). Credit notes can't
 * be created blank — they must reference an existing tax invoice — so
 * this acts as a "navigate away" affordance rather than a selectable
 * state. When chosen we forward the currently selected customer (if
 * any) so the picker can skip step 1.
 */
const CREDIT_NAV_SENTINEL = "__credit_nav__";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  address: string | null;
  taxId: string | null;
}

interface BusinessEntityContext {
  legalName: string;
  entityType: string;
  osekMurshe: string | null;
  address?: {
    street?: string;
    city?: string;
    zip?: string;
    country?: string;
  } | null;
  /**
   * Tenant default for the "Include VAT" toggle. Seeds the initial
   * state of the per-invoice toggle; the user can still flip it
   * before creating the document. Falls back to `true` when no
   * business entity is loaded (first-time setup preview).
   */
  defaultVatInclusive?: boolean;
}

interface CreateInvoiceFormProps {
  templateConfig: TemplateConfig;
  templateId: string | null;
  customers: Customer[];
  /**
   * Preview of the next sequence number per supported document type;
   * NOT a reservation. The form swaps the displayed value as the user
   * changes the doc-type dropdown so the prefix (`TI` / `TIR` / `RC`)
   * always matches the selected document.
   */
  previewByDocType: Record<CreateDocType, string>;
  /**
   * The Bank-of-Israel rate per currency (ILS per 1 unit), resolved
   * server-side and passed in so the live preview shows the real statutory
   * ILS totals. The form is a client component and can't read the server's
   * FX cache. Keyed by currency: a single USD rate used to be applied to
   * whatever currency was picked.
   */
  ratesToIls?: Partial<Record<string, number>>;
  businessEntity?: BusinessEntityContext;
  /** Initial document type — defaults to TAX_INVOICE. */
  initialDocumentType?: CreateDocType;
  /** Preselect a customer (e.g. arriving from the customer detail page). */
  initialCustomerId?: string;
  /**
   * When set, the form is in "Issue Receipt for invoice" mode:
   *   - document type is locked to RECEIPT
   *   - customer + currency are inherited from the parent invoice
   *   - total defaults to the parent's outstanding balance
   *   - a banner appears at the top explaining what the user is doing
   *   - on submit, `referencesDocumentId` is sent so the issue flow can
   *     flip the parent to `paid` once the balance clears
   */
  forInvoice?: {
    id: string;
    formattedNumber: string;
    outstandingAmount: number;
    currency: string;
  };
  /**
   * Render-time error from the parent loader (parent not found, wrong
   * type, already paid, etc). When set the form refuses to render — the
   * "Issue Receipt" entry only opens for eligible invoices, so this is
   * reachable only via stale tabs / hand-typed URLs.
   */
  forInvoiceError?: string;
  /**
   * When set, the form is in "Convert to Tax Invoice" mode — opened
   * from the detail page of an issued PROFORMA or DELIVERY_NOTE:
   *   - document type is locked to TAX_INVOICE
   *   - customer + currency + items are inherited from the source
   *   - on submit, `referencesDocumentId` is sent so the new TI
   *     back-references the source for traceability
   *   - a banner appears at the top explaining the conversion
   */
  forSource?: {
    id: string;
    formattedNumber: string;
    sourceType: "PROFORMA" | "DELIVERY_NOTE";
    items: InvoiceLineItem[];
    subtotal: string;
    vatRate: string | null;
    vatAmount: string | null;
    total: string;
    currency: string;
    language: string;
  };
  /** Counterpart of `forInvoiceError` for the conversion flow. */
  forSourceError?: string;
  /** When false, a withholding payment row offers the certificate upload. */
  hasWithholdingCertificate?: boolean;
}

const emptyItem: InvoiceLineItem = { description: "", quantity: 1, unitPrice: 0, total: 0 };

export function CreateInvoiceForm({
  templateConfig,
  templateId,
  customers: initialCustomers,
  previewByDocType,
  ratesToIls,
  businessEntity,
  initialDocumentType = "TAX_INVOICE",
  initialCustomerId,
  forInvoice,
  forInvoiceError,
  forSource,
  forSourceError,
  hasWithholdingCertificate = false,
}: CreateInvoiceFormProps) {
  const router = useRouter();
  const { dict, dir } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [showPreview, setShowPreview] = useState(false);
  const [customers, setCustomers] = useState(initialCustomers);

  const preselected = initialCustomerId
    ? initialCustomers.find((c) => c.id === initialCustomerId)
    : undefined;
  const [customerId, setCustomerId] = useState(preselected?.id ?? "");
  const [customerName, setCustomerName] = useState(preselected?.name ?? "");
  const [customerEmail, setCustomerEmail] = useState(preselected?.email ?? "");
  const [customerAddress, setCustomerAddress] = useState(
    preselected?.address ?? "",
  );
  const [customerTaxId, setCustomerTaxId] = useState(preselected?.taxId ?? "");
  // Inline "add tax ID" for an already-saved customer that turns out to be
  // missing one when the document crosses the ITA threshold.
  const [inlineTaxId, setInlineTaxId] = useState("");
  const [savingTaxId, setSavingTaxId] = useState(false);
  const [inlineTaxIdError, setInlineTaxIdError] = useState<string | null>(null);

  const [documentType, setDocumentType] =
    useState<CreateDocType>(initialDocumentType);
  const paymentsAllowed = allowsPayments(documentType);
  const paymentsRequired = requiresPayments(documentType);

  useEffect(() => {
    setDocumentType(initialDocumentType);
  }, [initialDocumentType]);

  function handleDocumentTypeChange(value: string) {
    if (value === CREDIT_NAV_SENTINEL) {
      // Credit notes use the dedicated picker — preserve the customer
      // if one is already selected (real id only, not "__new__" or
      // empty) so the picker can jump straight to step 2.
      const realCustomerId =
        customerId && customerId !== "__new__" ? customerId : null;
      const href = realCustomerId
        ? `/outbound/new-credit?customerId=${realCustomerId}`
        : "/outbound/new-credit";
      router.push(href);
      return;
    }
    setDocumentType(value as CreateDocType);
  }

  // Israel civil day, not UTC: `toISOString()` rolls back to "yesterday"
  // when the form opens just after midnight local time, which is how an
  // issue date ends up before a payment date entered the same evening.
  const [invoiceDate, setInvoiceDate] = useState(todayInIsrael());
  const [dueDate, setDueDate] = useState("");
  // In "Issue Receipt for invoice" mode, the receipt's currency is
  // forced to match the parent invoice's so the validation in
  // `getReceiptParentForCreate` (which we call again on submit) can't
  // reject the only data path the user has — the currency picker is
  // hidden in that mode.
  const [currency, setCurrency] = useState(
    forInvoice?.currency ?? forSource?.currency ?? templateConfig.defaultCurrency,
  );
  const [language, setLanguage] = useState(
    forSource?.language ?? templateConfig.defaultLanguage,
  );
  // Receipts carry no VAT — the parent tax invoice already collected
  // it. Force `vatInclusive=false` so the line-total + receipt-total
  // mathematically match the outstanding balance the parent expects to
  // see settled.
  // Conversion mode (proforma / delivery note → tax invoice) inherits
  // the source's VAT state by parsing its persisted vatRate. Receipts
  // force `vatInclusive=false` (the parent invoice already collected
  // VAT). Default for fresh drafts comes from the business entity.
  const sourceVatInclusive = forSource
    ? Number(forSource.vatRate ?? "0") > 0
    : null;
  const [vatInclusive, setVatInclusive] = useState(
    forInvoice
      ? false
      : sourceVatInclusive !== null
        ? sourceVatInclusive
        : businessEntity?.defaultVatInclusive ?? true,
  );
  const vatRate = vatRateForInclusive(vatInclusive);
  const [notes, setNotes] = useState("");
  // Receipt mode: single line "Payment for invoice {N}" sized to the
  // outstanding balance.
  // Conversion mode: copy the source's items verbatim — same products,
  // same prices. The seller can edit before issuing (e.g. drop a line
  // that was quoted but not delivered). VAT recomputes off the toggle.
  // Default: a single empty line.
  const initialItems: InvoiceLineItem[] = forInvoice
    ? [
        {
          description:
            (templateConfig.defaultLanguage === "he"
              ? `תשלום ע״ח חשבונית מס ${forInvoice.formattedNumber}`
              : `Payment for invoice ${forInvoice.formattedNumber}`),
          quantity: 1,
          unitPrice: forInvoice.outstandingAmount,
          total: forInvoice.outstandingAmount,
        },
      ]
    : forSource
      ? forSource.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.quantity * it.unitPrice,
        }))
      : [{ ...emptyItem }];
  const [items, setItems] = useState<InvoiceLineItem[]>(initialItems);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);

  const [error, setError] = useState("");

  function handleCustomerSelect(id: string) {
    const switchingFromSaved = Boolean(customerId && customerId !== "__new__");
    setCustomerId(id);
    if (id === "__new__") {
      // Voice (and a second click on "new") must not wipe a name already typed.
      if (switchingFromSaved) {
        setCustomerName("");
        setCustomerEmail("");
        setCustomerAddress("");
        setCustomerTaxId("");
      }
      return;
    }
    const c = customers.find((c) => c.id === id);
    if (c) {
      setCustomerName(c.name);
      setCustomerEmail(c.email ?? "");
      setCustomerAddress(c.address ?? "");
      setCustomerTaxId(c.taxId ?? "");
    }
    setInlineTaxId("");
    setInlineTaxIdError(null);
  }

  /**
   * Persist a missing tax ID on the selected customer without leaving the
   * form. On success the local `customerTaxId` is updated too, which clears
   * `taxIdRequired` and unblocks the submit button immediately.
   */
  async function handleSaveInlineTaxId() {
    const value = inlineTaxId.trim();
    if (!value || !customerId || customerId === "__new__") return;
    setSavingTaxId(true);
    setInlineTaxIdError(null);
    try {
      const row = await updateCustomer(customerId, { taxId: value });
      if (!row) {
        setInlineTaxIdError(cf.addTaxIdFailed);
        return;
      }
      setCustomerTaxId(value);
      setInlineTaxId("");
      router.refresh();
    } catch {
      setInlineTaxIdError(cf.addTaxIdFailed);
    } finally {
      setSavingTaxId(false);
    }
  }

  function updateItem(index: number, field: keyof InvoiceLineItem, value: string | number) {
    setItems((prev) => {
      const copy = [...prev];
      const item = { ...copy[index] };
      if (field === "description") {
        item.description = (value as string).slice(0, MAX_LINE_DESCRIPTION_LENGTH);
      } else {
        item[field] = Number(value) || 0;
      }
      item.total = item.quantity * item.unitPrice;
      copy[index] = item;
      return copy;
    });
  }

  function addItem() {
    setItems((prev) =>
      prev.length >= MAX_INVOICE_LINES ? prev : [...prev, { ...emptyItem }],
    );
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
  const paymentsSum =
    Math.round(payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0) * 100) / 100;
  const total = subtotal + vatAmount;

  const threshold = getThresholdForDate(new Date(invoiceDate));
  const isAboveThreshold = currency === "ILS" && subtotal >= threshold;
  const selectedCustomer = customers.find((c) => c.id === customerId);
  // Hard block: ILS invoice >= ₪5,000 with no customer tax ID.
  const taxIdRequired =
    currency === "ILS" &&
    subtotal >= CUSTOMER_TAX_ID_REQUIRED_THRESHOLD &&
    !customerTaxId.trim();
  const customerIsOsekMurshe = Boolean(
    (selectedCustomer?.taxId ?? customerTaxId)?.trim(),
  );
  const needsEntityOsekWarning =
    businessEntity != null &&
    !businessEntity.osekMurshe &&
    (businessEntity.entityType === "OSEK_MURSHE" ||
      businessEntity.entityType === "CHEVRA_BAAM");
  // Hard ITA rule: an invoice without the issuer's legal name,
  // 9-digit tax ID, and registered address (street + city) cannot
  // be created. Block the submit button and show a clear banner.
  const missingIssuerFields = businessEntity
    ? getMissingIssuerFields({
        legalName: businessEntity.legalName,
        osekMurshe: businessEntity.osekMurshe,
        address: businessEntity.address ?? null,
      })
    : ["legalName"];
  const issuerIncomplete = missingIssuerFields.length > 0;

  const paymentValidation = paymentsAllowed
    ? validatePayments(payments, documentType, total, currency)
    : null;

  const previewFormattedNumber = previewByDocType[documentType];

  const invoiceData: InvoiceData = withForeignExchangeDisplay({
    invoiceNumber: previewFormattedNumber,
    invoiceDate,
    dueDate: dueDate || undefined,
    customerName: customerName || "—",
    customerEmail: customerEmail || undefined,
    customerAddress: customerAddress || undefined,
    customerTaxId: customerTaxId || undefined,
    items: items.map((item) => ({
      ...item,
      total: item.quantity * item.unitPrice,
    })),
    subtotal,
    vatRate,
    vatAmount,
    total,
    currency,
    language,
    notes: notes || undefined,
    documentType,
    payments: paymentsAllowed ? payments : [],
    // Draft — no מקור marker shown in the preview; the draft state
    // already signals non-final via the draft watermark on the PDF.
    copyMarker: null,
  }, ratesToIls?.[currency.toUpperCase()]);

  const cf = dict.outbound.createForm;

  // Live list of everything currently blocking creation, surfaced in a
  // warning box next to the (disabled) submit button so the user knows
  // exactly what to fix. The submit button's `disabled` state is derived
  // from this same list, so the two can never drift apart.
  const blockers: string[] = [];
  if (issuerIncomplete) blockers.push(cf.blockers.issuerIncomplete);
  if (!customerName.trim()) blockers.push(cf.blockers.customerName);
  if (items.length === 0 || items.every((i) => !i.description.trim())) {
    blockers.push(cf.blockers.lineItem);
  }
  if (items.length > MAX_INVOICE_LINES) {
    blockers.push(format(cf.lineLimit, { max: MAX_INVOICE_LINES }));
  }
  if (items.some((item) => item.description.length > MAX_LINE_DESCRIPTION_LENGTH)) {
    blockers.push(format(cf.descriptionLimit, { max: MAX_LINE_DESCRIPTION_LENGTH }));
  }
  if (notes.length > MAX_INVOICE_NOTES_LENGTH) {
    blockers.push(format(cf.notesLimit, { max: MAX_INVOICE_NOTES_LENGTH }));
  }
  if (total <= 0) blockers.push(cf.blockers.totalPositive);
  if (taxIdRequired) blockers.push(cf.blockers.taxId);
  if (paymentsAllowed && paymentValidation) {
    switch (paymentValidation.code) {
      case "MISSING":
        blockers.push(cf.blockers.paymentRequired);
        break;
      case "NON_POSITIVE":
        blockers.push(cf.blockers.paymentPositive);
        break;
      case "MISSING_REFERENCE":
        blockers.push(cf.blockers.paymentReference);
        break;
      case "SUM_MISMATCH": {
        const paymentsSum =
          Math.round(
            payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0) * 100,
          ) / 100;
        const delta = Math.round((total - paymentsSum) * 100) / 100;
        // A currency mismatch also surfaces as SUM_MISMATCH; distinguish it
        // from a plain amount gap so the message is actionable.
        const currencyMismatch = payments.some(
          (p) => p.currency.toUpperCase() !== currency.toUpperCase(),
        );
        blockers.push(
          currencyMismatch
            ? format(cf.blockers.paymentCurrency, { currency })
            : format(cf.blockers.paymentSum, {
                required: total.toFixed(2),
                sum: paymentsSum.toFixed(2),
                delta: `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`,
                currency,
              }),
        );
        break;
      }
      default:
        blockers.push(paymentValidation.message);
    }
  }

  const hasHardError = Boolean(forInvoiceError) || Boolean(forSourceError);
  const isBlocked = blockers.length > 0 || hasHardError;

  const blockerNotice = (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
      data-voice-blockers=""
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 space-y-1">
        <p className="font-semibold">{cf.blockers.title}</p>
        <ul className="list-disc space-y-0.5 ps-5">
          {blockers.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>
    </div>
  );

  async function handleSubmit() {
    if (!customerName.trim()) {
      setError(cf.errors.customerNameRequired);
      return;
    }
    if (items.length === 0 || items.every((i) => !i.description.trim())) {
      setError(cf.errors.addLineItem);
      return;
    }
    if (total <= 0) {
      setError(cf.blockers.totalPositive);
      return;
    }
    if (paymentsAllowed && paymentValidation) {
      setError(paymentValidation.message);
      return;
    }

    startTransition(async () => {
      try {
        let resolvedCustomerId = customerId;

        if (customerId === "__new__" || !customerId) {
          const newCustomer = await createCustomer({
            name: customerName,
            email: customerEmail || undefined,
            address: customerAddress || undefined,
            taxId: customerTaxId || undefined,
          });
          resolvedCustomerId = newCustomer.id;
          setCustomers((prev) => [...prev, { ...newCustomer, email: newCustomer.email ?? null, address: newCustomer.address ?? null, taxId: newCustomer.taxId ?? null }]);
        }

        const invoice = await createOutboundInvoice({
          templateId: templateId ?? undefined,
          customerId: resolvedCustomerId || undefined,
          documentType,
          invoiceDate,
          dueDate: dueDate || undefined,
          items: items.map((item) => ({
            ...item,
            total: item.quantity * item.unitPrice,
          })),
          subtotal: subtotal.toFixed(2),
          vatRate: vatRate.toFixed(2),
          vatAmount: vatAmount.toFixed(2),
          total: total.toFixed(2),
          currency,
          language,
          notes: notes || undefined,
          customerEmail: customerEmail.trim(),
          payments: paymentsAllowed ? payments : undefined,
          referencesDocumentId: forInvoice?.id ?? forSource?.id,
        });

        router.push(`/outbound/${invoice.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : cf.errors.createFailed);
      }
    });
  }

  return (
    <div
      className="space-y-6"
      data-voice-doc=""
      data-voice-doc-type={documentType}
      data-voice-subtotal={subtotal.toFixed(2)}
      data-voice-vat-rate={String(vatRate)}
      data-voice-vat={vatInclusive ? "with" : "without"}
      data-voice-vat-amount={vatAmount.toFixed(2)}
      data-voice-total={total.toFixed(2)}
      data-voice-currency={currency}
      data-voice-payments-required={paymentsRequired ? "true" : "false"}
      data-voice-payments-sum={paymentsSum.toFixed(2)}
    >
      {/* Toggle preview */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{cf.pageTitle}</h1>
        <Button
          variant="outline"
          onClick={() => setShowPreview((p) => !p)}
          className="gap-2"
        >
          {showPreview ? <FileText className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {showPreview ? cf.previewToggleEdit : cf.previewToggleShow}
        </Button>
      </div>

      {forInvoiceError && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="flex items-start gap-3 py-4 text-sm text-red-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1 space-y-2">
              <p className="font-semibold">{cf.forInvoice.errorTitle}</p>
              <p className="text-xs">{forInvoiceError}</p>
              <Link
                href="/outbound"
                className="inline-block text-xs font-medium underline"
              >
                {cf.forInvoice.backToList} →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {forSourceError && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="flex items-start gap-3 py-4 text-sm text-red-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1 space-y-2">
              <p className="font-semibold">{cf.forSource.errorTitle}</p>
              <p className="text-xs">{forSourceError}</p>
              <Link
                href="/outbound"
                className="inline-block text-xs font-medium underline"
              >
                {cf.forInvoice.backToList} →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {forSource && !forSourceError && (
        <Card className="border-indigo-200 bg-indigo-50/60">
          <CardContent className="flex items-start gap-3 py-3 text-sm text-indigo-900">
            <FileText className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1 space-y-1">
              <p className="font-semibold">
                {format(
                  forSource.sourceType === "PROFORMA"
                    ? cf.forSource.bannerTitleProforma
                    : cf.forSource.bannerTitleDeliveryNote,
                  { number: forSource.formattedNumber },
                )}
              </p>
              <p className="text-xs">{cf.forSource.bannerBody}</p>
            </div>
            <Link
              href={`/outbound/${forSource.id}`}
              className="self-center text-xs font-medium underline"
            >
              {cf.forSource.viewSource} →
            </Link>
          </CardContent>
        </Card>
      )}

      {forInvoice && !forInvoiceError && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="flex items-start gap-3 py-3 text-sm text-emerald-900">
            <Wallet className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1 space-y-1">
              <p className="font-semibold">
                {format(cf.forInvoice.bannerTitle, {
                  number: forInvoice.formattedNumber,
                })}
              </p>
              <p className="text-xs">
                {format(cf.forInvoice.bannerBody, {
                  amount: forInvoice.outstandingAmount.toLocaleString(
                    undefined,
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                  ),
                  currency: forInvoice.currency,
                })}
              </p>
            </div>
            <Link
              href={`/outbound/${forInvoice.id}`}
              className="self-center text-xs font-medium underline"
            >
              {cf.forInvoice.viewInvoice} →
            </Link>
          </CardContent>
        </Card>
      )}

      {businessEntity && (
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardContent className="flex flex-wrap items-start gap-3 py-3 text-sm">
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wider text-gray-500">
                {dict.outbound.createForm.issuingAs}
              </p>
              <p className="font-semibold">
                {businessEntity.legalName}{" "}
                <span className="text-xs text-gray-500">
                  ({businessEntity.entityType}
                  {businessEntity.osekMurshe
                    ? `, .ע.מ ${businessEntity.osekMurshe}`
                    : ""})
                </span>
              </p>
            </div>
            {needsEntityOsekWarning && !issuerIncomplete && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p>{dict.outbound.createForm.issuingAsMissingOsek}</p>
                  <Link
                    href="/creator/business-details"
                    className="font-medium underline"
                  >
                    {dict.outbound.createForm.openEntitySettings} →
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {issuerIncomplete && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="flex items-start gap-3 py-4 text-sm text-red-900">
            <Lock className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1 space-y-2">
              <p className="font-semibold">{cf.issuerIncompleteTitle}</p>
              <p className="text-xs">{cf.issuerIncompleteBody}</p>
              <ul className="list-disc space-y-1 ps-5 text-xs">
                {missingIssuerFields.map((f) => (
                  <li key={f} className="font-mono">
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/creator/business-details"
                className="inline-block text-xs font-medium underline"
              >
                {dict.outbound.createForm.openEntitySettings} →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {showPreview ? (
        <div className="mx-auto max-w-3xl">
          <TemplatePreview config={templateConfig} invoice={invoiceData} />
          {blockers.length > 0 && <div className="mt-4">{blockerNotice}</div>}
          <div className="mt-4 flex gap-3">
            <Button
              onClick={handleSubmit}
              disabled={isPending || isBlocked}
              className="flex-1"
              data-voice-action="submit-document"
              data-highlight="doc-submit"
            >
              {isPending ? cf.submitting : cf.submit}
            </Button>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              {cf.backToEdit}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Form — takes 3 cols */}
          <div className="space-y-6 lg:col-span-3">
            {/* Document type — first, so picking Credit routes out before
                the user fills anything else. */}
            <Card data-voice-section="doc-type">
              <CardHeader>
                <CardTitle className="text-base">
                  {dict.documents.type.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Select
                  value={documentType}
                  onValueChange={handleDocumentTypeChange}
                  disabled={Boolean(forInvoice) || Boolean(forSource)}
                >
                  <SelectTrigger
                    data-highlight="doc-type"
                    data-voice-field="documentType"
                    data-voice-select="true"
                    data-voice-value={documentType}
                    className={forInvoice || forSource ? "bg-gray-100" : undefined}
                  >
                    <SelectValue>
                      {dict.documents.type[documentType]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CREATE_TYPES.map((t) => (
                      <SelectItem key={t} value={t} data-value={t}>
                        {dict.documents.type[t]}
                      </SelectItem>
                    ))}
                    <SelectItem value={CREDIT_NAV_SENTINEL} data-value="CREDIT_INVOICE">
                      {dict.documents.type.CREDIT_INVOICE}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Customer */}
            <Card data-voice-section="doc-customer">
              <CardHeader>
                <CardTitle className="text-base">{cf.sectionCustomer}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select
                  value={customerId}
                  onValueChange={handleCustomerSelect}
                  disabled={Boolean(forInvoice) || Boolean(forSource)}
                >
                  <SelectTrigger
                    data-highlight="doc-customer"
                    data-voice-field="customer"
                    data-voice-select="true"
                    data-voice-value={customerName.trim() || selectedCustomer?.name || ""}
                    className={forInvoice || forSource ? "bg-gray-100" : undefined}
                  >
                    <SelectValue placeholder={cf.customerSelectPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__new__" data-value="__new__">{cf.customerNew}</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id} data-value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {customerId && customerId !== "__new__" && (
                  <div className="space-y-1">
                    <Label className="text-xs">{cf.customerEmailLabel}</Label>
                    <Input
                      type="email"
                      placeholder={cf.customerEmailPh}
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      data-voice-field="customerEmail"
                      data-highlight="doc-customer-email"
                    />
                    <p className="text-[11px] text-gray-500">{cf.customerEmailHint}</p>
                    {selectedCustomer &&
                      customerEmail.trim() !== (selectedCustomer.email ?? "").trim() && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto px-0 text-xs font-medium text-primary underline underline-offset-4"
                          onClick={() =>
                            setCustomerEmail(selectedCustomer.email ?? "")
                          }
                        >
                          {cf.customerEmailRestore}
                        </Button>
                      )}
                  </div>
                )}

                {(customerId === "__new__" || !customerId) && (
                  <div className="space-y-3">
                    <Input
                      placeholder={cf.customerNamePh}
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      data-voice-field="customerName"
                      data-highlight="doc-customer-name"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        placeholder={cf.customerEmailPh}
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        data-voice-field="customerEmail"
                        data-highlight="doc-customer-email"
                      />
                      <div className="space-y-1">
                        <Input
                          placeholder={
                            taxIdRequired
                              ? `${cf.customerTaxIdPh} *`
                              : cf.customerTaxIdPh
                          }
                          value={customerTaxId}
                          onChange={(e) => setCustomerTaxId(e.target.value)}
                          data-voice-field="customerTaxId"
                          data-highlight="doc-customer-tax-id"
                          className={taxIdRequired ? "border-red-400 focus-visible:ring-red-400" : undefined}
                        />
                        {taxIdRequired && (
                          <p className="text-xs text-red-600">
                            {cf.customerMissingTaxIdAboveThreshold}
                          </p>
                        )}
                      </div>
                    </div>
                    <Textarea
                      placeholder={cf.customerAddressPh}
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      rows={2}
                      data-voice-field="customerAddress"
                      data-highlight="doc-customer-address"
                    />
                  </div>
                )}
                {customerId && customerId !== "__new__" && !customerIsOsekMurshe && (
                  taxIdRequired ? (
                    <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <div className="flex-1 space-y-2">
                        <span>{cf.customerMissingTaxIdAboveThreshold}</span>
                        {/* Saved inline rather than linking away to the
                            customer record: the form holds the whole
                            document in component state, so a navigation
                            here would throw away the line items the user
                            just typed and drop them back on an empty form. */}
                        <div className="flex items-start gap-2">
                          <Input
                            placeholder={cf.customerTaxIdPh}
                            value={inlineTaxId}
                            onChange={(e) => {
                              setInlineTaxId(e.target.value);
                              setInlineTaxIdError(null);
                            }}
                            className="h-8 max-w-[12rem] bg-white text-xs"
                            data-voice-field="customerTaxIdInline"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 bg-white"
                            disabled={!inlineTaxId.trim() || savingTaxId}
                            onClick={handleSaveInlineTaxId}
                          >
                            {savingTaxId ? cf.addTaxIdSaving : cf.addTaxId}
                          </Button>
                        </div>
                        {inlineTaxIdError && (
                          <p className="font-medium">{inlineTaxIdError}</p>
                        )}
                        <div>
                          <Link
                            href={`/customers/${customerId}`}
                            className="underline"
                          >
                            {cf.openCustomerRecord} →
                          </Link>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{dict.outbound.createForm.customerHasNoOsek}</span>
                    </div>
                  )
                )}
              </CardContent>
            </Card>

            {/* Document details — heading reflects the selected type
                (Tax Invoice / Receipt / Tax Invoice + Receipt) so it
                doesn't say "Invoice details" when the user is creating
                a Receipt. */}
            <Card data-voice-section="doc-details">
              <CardHeader>
                <CardTitle className="text-base">
                  {format(cf.sectionDocumentDetails, {
                    type: dict.documents.type[documentType],
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{dict.documents.numbering.nextAvailable}</Label>
                    <Input value={previewFormattedNumber} readOnly disabled />
                    <p className="text-[11px] text-gray-500">
                      {format(dict.outbound.createForm.nextAvailableHint, {
                        number: previewFormattedNumber,
                      })}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{cf.dateLabel}</Label>
                    <Input
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      data-voice-field="invoiceDate"
                      data-highlight="doc-date"
                    />
                    <p className="text-[11px] text-gray-500">{cf.dateHint}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{cf.dueDateLabel}</Label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      data-voice-field="dueDate"
                      data-highlight="doc-due-date"
                    />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{cf.vatLabel}</Label>
                    <Select
                      value={vatInclusive ? "with" : "without"}
                      onValueChange={(v) => setVatInclusive(v === "with")}
                    >
                      <SelectTrigger data-voice-field="vat" data-voice-select="true" data-highlight="doc-vat">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="with" data-value="with">
                          {format(cf.vatWith, { rate: vatRateForInclusive(true) })}
                        </SelectItem>
                        <SelectItem value="without" data-value="without">{cf.vatWithout}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{cf.currencyLabel}</Label>
                    <Select
                      value={currency}
                      onValueChange={setCurrency}
                      disabled={Boolean(forInvoice) || Boolean(forSource)}
                    >
                      <SelectTrigger
                        data-voice-field="currency"
                        data-voice-select="true"
                        data-highlight="doc-currency"
                        className={forInvoice || forSource ? "bg-gray-100" : undefined}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ILS" data-value="ILS">₪ ILS</SelectItem>
                        <SelectItem value="USD" data-value="USD">$ USD</SelectItem>
                        <SelectItem value="EUR" data-value="EUR">€ EUR</SelectItem>
                        <SelectItem value="GBP" data-value="GBP">£ GBP</SelectItem>
                      </SelectContent>
                    </Select>
                    {currency !== "ILS" && ratesToIls?.[currency.toUpperCase()] == null && (
                      <p className="text-xs text-amber-700">{cf.fxRateUnavailable}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{cf.languageLabel}</Label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger data-voice-field="language" data-voice-select="true" data-highlight="doc-language">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="he" data-value="he">עברית</SelectItem>
                        <SelectItem value="en" data-value="en">English</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Line items */}
            <Card data-voice-section="doc-items">
              <CardHeader>
                <CardTitle className="text-base">{cf.sectionLineItems}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((item, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-2 sm:flex-row sm:items-start sm:border-0 sm:bg-transparent sm:p-0"
                  >
                    <Input
                      placeholder={cf.itemDescriptionPh}
                      value={item.description}
                      onChange={(e) => updateItem(i, "description", e.target.value)}
                      maxLength={MAX_LINE_DESCRIPTION_LENGTH}
                      className="flex-1"
                      data-voice-field={i === 0 ? "itemDescription" : `itemDescription-${i}`}
                      data-highlight={i === 0 ? "doc-item-description" : undefined}
                    />
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        placeholder={cf.itemQuantityPh}
                        value={item.quantity || ""}
                        onChange={(e) => updateItem(i, "quantity", e.target.value)}
                        className="w-full min-w-0 sm:w-20"
                        data-voice-field={i === 0 ? "itemQuantity" : `itemQuantity-${i}`}
                      />
                      <Input
                        type="number"
                        placeholder={cf.itemPricePh}
                        value={item.unitPrice || ""}
                        onChange={(e) => updateItem(i, "unitPrice", e.target.value)}
                        className="w-full min-w-0 sm:w-28"
                        data-voice-field={i === 0 ? "itemPrice" : `itemPrice-${i}`}
                      />
                      <div className="flex w-24 shrink-0 items-center justify-end text-sm font-medium">
                        {(item.quantity * item.unitPrice).toLocaleString()}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(i)}
                        disabled={items.length === 1}
                        className="shrink-0"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addItem}
                  disabled={items.length >= MAX_INVOICE_LINES}
                  className="gap-1"
                  data-voice-action="add-item"
                  data-highlight="doc-add-item"
                >
                  <Plus className="h-4 w-4" /> {cf.addItem}
                </Button>
                {items.length >= MAX_INVOICE_LINES && (
                  <p className="text-xs text-muted-foreground">
                    {format(cf.lineLimit, { max: MAX_INVOICE_LINES })}
                  </p>
                )}

                {/* Totals summary */}
                <div className="mt-4 space-y-1 border-t pt-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">{cf.subtotalLabel}</span>
                    <span>{subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      {format(cf.vatRowLabel, { rate: vatRate })}
                    </span>
                    <span>{vatAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1 font-bold">
                    <span>{cf.totalLabel}</span>
                    <span>{total.toLocaleString()} {currency}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {paymentsAllowed && (
              <Card data-voice-section="doc-payments">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Wallet className="h-4 w-4" />
                    {dict.outbound.payments.cardTitle}
                  </CardTitle>
                  <p className="text-xs text-gray-500">
                    {paymentsRequired
                      ? dict.outbound.payments.requiredNote
                      : dict.outbound.payments.optionalNote}
                  </p>
                </CardHeader>
                <CardContent>
                  <PaymentsInput
                    value={payments}
                    onChange={setPayments}
                    currency={currency}
                    total={total}
                    defaultDate={invoiceDate}
                    hasWithholdingCertificate={hasWithholdingCertificate}
                    customerTaxId={customerTaxId}
                    fxRateToIls={ratesToIls?.[currency.toUpperCase()] ?? null}
                  />
                </CardContent>
              </Card>
            )}

            {/* Notes */}
            <Card data-voice-section="doc-notes">
              <CardHeader>
                <CardTitle className="text-base">{cf.sectionNotes}</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder={cf.notesPh}
                  value={notes}
                  maxLength={MAX_INVOICE_NOTES_LENGTH}
                  onChange={(e) =>
                    setNotes(e.target.value.slice(0, MAX_INVOICE_NOTES_LENGTH))
                  }
                  rows={3}
                  data-voice-field="notes"
                  data-highlight="doc-notes"
                />
              </CardContent>
            </Card>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div
              className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
                isAboveThreshold
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-blue-200 bg-blue-50 text-blue-900"
              }`}
            >
              <Info className="h-4 w-4 shrink-0" />
              <span>
                {isAboveThreshold
                  ? dict.outbound.createForm.thresholdNoteAbove
                  : dict.outbound.createForm.thresholdNoteBelow}
              </span>
            </div>

            {blockers.length > 0 && blockerNotice}

            <Button
              onClick={handleSubmit}
              disabled={isPending || isBlocked}
              className="w-full"
              size="lg"
              data-voice-action="submit-document"
              data-highlight="doc-submit"
            >
              {isPending ? cf.submitting : cf.submit}
            </Button>
          </div>

          {/* Live mini preview — takes 2 cols */}
          <div className="hidden lg:col-span-2 lg:block">
            <div className="sticky top-6">
              <Label className="mb-2 block text-sm font-semibold text-gray-500">{cf.sidePreviewLabel}</Label>
              <div
                className={`scale-[0.6] ${dir === "rtl" ? "origin-top-right" : "origin-top-left"}`}
                style={{ width: "166.67%" }}
              >
                <TemplatePreview config={templateConfig} invoice={invoiceData} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
