import { notFound } from "next/navigation";
import { getInvoiceById, getAuditLog } from "@/features/expenses/actions/invoice-actions";
import { getVendors } from "@/features/expenses/actions/vendor-actions";
import { isPeriodLockedForInvoiceDate } from "@/features/expenses/actions/period-actions";
import { InvoiceDetailClient } from "@/features/expenses/components/invoices/invoice-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function InvoiceDetailPage({ params }: Props) {
  const { id } = await params;
  const [invoice, vendorRows] = await Promise.all([
    getInvoiceById(id),
    getVendors(),
  ]);

  if (!invoice) {
    notFound();
  }

  const vendors = vendorRows.map((v) => ({ id: v.id, name: v.name, isIncomeSource: v.isIncomeSource ?? false }));

  let auditEntries: { id: string; action: string; details: unknown; createdAt: Date | null }[] = [];
  try {
    auditEntries = await getAuditLog(id);
  } catch {
    // Audit log may not be available
  }

  const invoicePeriodLocked = await isPeriodLockedForInvoiceDate(
    invoice.invoiceDate
  );

  return (
    <InvoiceDetailClient
      invoice={{
        id: invoice.id,
        vendorId: invoice.vendorId,
        suggestedVendorName: invoice.suggestedVendorName,
        vendorName: invoice.vendorName,
        vendorCategory: invoice.vendorCategory,
        type: invoice.type,
        status: invoice.status,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        amount: invoice.amount,
        currency: invoice.currency,
        vatAmount: invoice.vatAmount,
        amountWithoutVat: invoice.amountWithoutVat,
        description: invoice.description,
        expenseCategory: invoice.expenseCategory,
        isFixedAsset: invoice.isFixedAsset,
        fixedAssetSynced: invoice.fixedAssetSynced,
        fileUrl: invoice.fileUrl,
        fileName: invoice.fileName,
        extractionMethod: invoice.extractionMethod,
        extractionConfidence: invoice.extractionConfidence,
        rejectionReason: invoice.rejectionReason,
        addedMonth: invoice.addedMonth,
        sentToAccountantAt: invoice.sentToAccountantAt
          ? new Date(invoice.sentToAccountantAt as Date | string).toISOString()
          : null,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
      }}
      vendors={vendors}
      auditLog={auditEntries}
      invoicePeriodLocked={invoicePeriodLocked}
    />
  );
}
