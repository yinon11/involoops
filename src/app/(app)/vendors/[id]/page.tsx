import { notFound } from "next/navigation";
import { getVendorById } from "@/features/expenses/actions/vendor-actions";
import { getInvoices } from "@/features/expenses/actions/invoice-actions";
import { VendorDetailClient } from "@/features/expenses/components/vendors/vendor-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function VendorDetailPage({ params }: Props) {
  const { id } = await params;
  const vendor = await getVendorById(id);

  if (!vendor) {
    notFound();
  }

  const vendorInvoices = await getInvoices({ vendorId: id });

  const mappedInvoices = vendorInvoices.map((inv) => ({
    id: inv.id,
    invoiceDate: inv.invoiceDate ?? "",
    vendorName: inv.vendorName ?? "Unknown",
    vendorId: inv.vendorId,
    suggestedVendorName: inv.suggestedVendorName,
    amount: inv.amount ? parseFloat(inv.amount) : 0,
    vatAmount: inv.vatAmount ? parseFloat(inv.vatAmount) : null,
    currency: inv.currency ?? "ILS",
    invoiceNumber: inv.invoiceNumber,
    fileUrl: inv.fileUrl,
    addedMonth: inv.addedMonth ?? "",
    status: inv.status ?? "processing",
    sentToAccountantAt: inv.sentToAccountantAt
      ? new Date(inv.sentToAccountantAt).toISOString()
      : null,
  }));

  return (
    <VendorDetailClient
      vendor={{
        id: vendor.id,
        name: vendor.name,
        aliases: (vendor.aliases ?? []) as string[],
        defaultCategory: vendor.defaultCategory,
        isIncomeSource: vendor.isIncomeSource,
        autoApprove: vendor.autoApprove,
      }}
      extractionRules={vendor.extractionRules.map((r) => ({
        id: r.id,
        vendorId: r.vendorId,
        name: r.name,
        priority: r.priority,
        rules: r.rules as Record<string, unknown>,
        isActive: r.isActive,
      }))}
      invoices={mappedInvoices}
    />
  );
}
