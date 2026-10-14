import { notFound } from "next/navigation";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import {
  getCustomerById,
  getCustomerInvoices,
} from "@/features/generator/actions/customer-actions";
import { getDictionary } from "@/lib/i18n/server";
import {
  CustomerDetailClient,
  type CustomerDetail,
  type CustomerInvoiceRow,
} from "@/features/generator/components/customers/customer-detail-client";
import type { OutboundInvoiceStatus } from "@/db/schema/outbound-invoices";
import type { ShaamStatus } from "@/features/generator/components/outbound/document-status-chip";

export const metadata = {
  title: "Customer",
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({ params }: Props) {
  const { id } = await params;
  await requireGeneratorAccess();

  const customer = await getCustomerById(id);
  if (!customer) notFound();

  const [invoices, dict] = await Promise.all([
    getCustomerInvoices(id),
    getDictionary(),
  ]);

  const customerData: CustomerDetail = {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    taxId: customer.taxId,
    notes: customer.notes,
  };

  const invoiceRows: CustomerInvoiceRow[] = invoices.map((inv) => ({
    id: inv.id,
    formattedNumber: inv.formattedNumber,
    documentType: inv.documentType,
    invoiceDate: inv.invoiceDate,
    total: inv.total,
    currency: inv.currency,
    status: inv.status as OutboundInvoiceStatus | null,
    shaamStatus: inv.shaamStatus as ShaamStatus,
  }));

  const D = dict.customers.detail;
  const C = dict.customers.create;

  return (
    <CustomerDetailClient
      customer={customerData}
      invoices={invoiceRows}
      labels={{
        back: D.back,
        editTitle: D.editTitle,
        editSubtitle: D.editSubtitle,
        save: D.save,
        saving: D.saving,
        delete: D.delete,
        deleteConfirmTitle: D.deleteConfirmTitle,
        deleteConfirmBody: D.deleteConfirmBody,
        deleteConfirmCta: D.deleteConfirmCta,
        cancel: C.cancel,
        saved: D.saved,
        saveFailed: D.saveFailed,
        deleted: D.deleted,
        deleteFailed: D.deleteFailed,
        namePh: C.namePh,
        emailPh: C.emailPh,
        phonePh: C.phonePh,
        taxIdPh: C.taxIdPh,
        addressPh: C.addressPh,
        notesPh: C.notesPh,
        createInvoiceCta: D.createInvoiceCta,
        invoicesTitle: D.invoicesTitle,
        invoicesSubtitle: D.invoicesSubtitle,
        invoicesEmpty: D.invoicesEmpty,
        invoicesCols: D.invoicesCols,
        stats: D.stats,
      }}
    />
  );
}
