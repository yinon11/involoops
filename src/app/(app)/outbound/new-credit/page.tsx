import Link from "next/link";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getDictionary } from "@/lib/i18n/server";
import {
  getCustomersWithCreditableInvoices,
  getCreditableInvoicesForCustomer,
} from "@/features/generator/actions/credit-note-actions";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import {
  CustomerFilterList,
  InvoiceFilterList,
} from "./filter-lists";

export const metadata = {
  title: "New credit invoice",
  robots: { index: false, follow: false },
};

/**
 * Two-step picker for issuing a credit invoice (חשבונית זיכוי).
 *
 *   Step 1 (no search param) — list customers that have at least one
 *     creditable invoice (TAX_INVOICE / TAX_INVOICE_RECEIPT with
 *     remaining balance).
 *   Step 2 (?customerId=…) — list the customer's creditable invoices;
 *     clicking one forwards to the existing /outbound/<id>/credit
 *     form.
 *
 * This route exists alongside the contextual "Issue Credit Note"
 * button on the invoice detail page — it adds discoverability from
 * the Create dropdown without removing the faster contextual entry.
 */
export default async function NewCreditInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  await requireGeneratorAccess();

  const { customerId } = await searchParams;
  const dict = await getDictionary();
  const L = dict.outbound.newCredit;

  if (!customerId) {
    const customers = await getCustomersWithCreditableInvoices();
    return (
      <div
        className="mx-auto max-w-3xl space-y-6"
        data-highlight="credit-picker"
        data-voice-doc=""
        data-voice-doc-type="CREDIT_INVOICE"
      >
        <header className="space-y-1">
          <Link
            href="/outbound"
            className="inline-flex items-center gap-1 text-sm text-violet-700 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {L.backToInvoices}
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">
            {L.step1Title}
          </h1>
          <p className="text-sm text-slate-500">{L.step1Subline}</p>
        </header>

        {customers.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
            {L.noCustomers}
          </div>
        ) : (
          <CustomerFilterList
            customers={customers}
            cardTitle={L.step1CardTitle}
            searchPlaceholder={L.searchCustomersPlaceholder}
            invoicesAvailableLabel={L.invoicesAvailable}
            noMatchesLabel={L.noCustomerMatches}
          />
        )}
      </div>
    );
  }

  // Step 2 — invoices for the selected customer.
  const invoices = await getCreditableInvoicesForCustomer(customerId);
  if (invoices.length === 0) {
    // Customer has no creditable invoices (e.g. URL tampering).
    return (
      <div
        className="mx-auto max-w-3xl space-y-6"
        data-highlight="credit-picker"
        data-voice-doc=""
        data-voice-doc-type="CREDIT_INVOICE"
      >
        <header className="space-y-1">
          <Link
            href="/outbound/new-credit"
            className="inline-flex items-center gap-1 text-sm text-violet-700 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {L.backToCustomers}
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">
            {L.noInvoicesTitle}
          </h1>
          <p className="text-sm text-slate-500">{L.noInvoices}</p>
        </header>
      </div>
    );
  }

  return (
      <div
        className="mx-auto max-w-3xl space-y-6"
        data-highlight="credit-picker"
        data-voice-doc=""
        data-voice-doc-type="CREDIT_INVOICE"
      >
      <header className="space-y-1">
        <Link
          href="/outbound/new-credit"
          className="inline-flex items-center gap-1 text-sm text-violet-700 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {L.backToCustomers}
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">
          {L.step2Title}
        </h1>
        <p className="text-sm text-slate-500">{L.step2Subline}</p>
      </header>

      <InvoiceFilterList
        invoices={invoices}
        documentTypeLabels={dict.documents.type}
        cardTitle={L.step2CardTitle}
        searchPlaceholder={L.searchInvoicesPlaceholder}
        partiallyCreditedLabel={L.partiallyCredited}
        noMatchesLabel={L.noInvoiceMatches}
      />

      <div className="flex justify-end">
        <Link href="/outbound">
          <Button variant="ghost" size="sm">
            {dict.common.cancel}
          </Button>
        </Link>
      </div>
    </div>
  );
}
