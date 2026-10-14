import { getInvoices } from "@/features/expenses/actions/invoice-actions";
import { getVendors } from "@/features/expenses/actions/vendor-actions";
import { InvoiceListClient } from "@/features/expenses/components/invoices/invoice-list-client";
import { FileText } from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";
import { ensureCapOrNotFound } from "@/lib/team/enforce";

export default async function InvoicesPage() {
  await ensureCapOrNotFound("view_invoices");
  const [allInvoices, vendors, dict] = await Promise.all([
    getInvoices(),
    getVendors(),
    getDictionary(),
  ]);

  const mappedInvoices = allInvoices.map((inv) => ({
    id: inv.id,
    invoiceDate: inv.invoiceDate ?? "",
    vendorName:
      inv.vendorName ?? inv.suggestedVendorName ?? dict.invoices.unknownVendor,
    vendorId: inv.vendorId,
    suggestedVendorName: inv.suggestedVendorName,
    amount: inv.amount ? parseFloat(inv.amount) : 0,
    vatAmount: inv.vatAmount ? parseFloat(inv.vatAmount) : null,
    currency: inv.currency ?? "ILS",
    invoiceNumber: inv.invoiceNumber,
    fileUrl: inv.fileUrl,
    addedMonth: inv.addedMonth ?? "",
    status: inv.status ?? "processing",
    type: inv.type ?? "expense",
    sentToAccountantAt: inv.sentToAccountantAt
      ? new Date(inv.sentToAccountantAt).toISOString()
      : null,
    isFixedAsset: inv.isFixedAsset,
    fixedAssetSynced: inv.fixedAssetSynced,
  }));

  const vendorList = vendors.map((v) => ({ id: v.id, name: v.name }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-indigo-500" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {dict.invoices.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {dict.invoices.subtitle}
          </p>
        </div>
      </div>

      <InvoiceListClient invoices={mappedInvoices} vendors={vendorList} />
    </div>
  );
}
