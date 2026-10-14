import { getVendors } from "@/features/expenses/actions/vendor-actions";
import { VendorTable } from "@/features/expenses/components/vendors/vendor-table";
import { VendorCreateDialog } from "@/features/expenses/components/vendors/vendor-create-dialog";
import { Store } from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";
import { ensureCapOrNotFound } from "@/lib/team/enforce";

export default async function VendorsPage() {
  await ensureCapOrNotFound("view_vendors");
  const [vendors, dict] = await Promise.all([getVendors(), getDictionary()]);

  const mapped = vendors.map((v) => ({
    id: v.id,
    name: v.name,
    aliases: (v.aliases ?? []) as string[],
    defaultCategory: v.defaultCategory,
    isIncomeSource: v.isIncomeSource,
    invoiceCount: v.invoiceCount,
    createdAt: v.createdAt,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Store className="h-6 w-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{dict.vendors.title}</h1>
            <p className="text-sm text-muted-foreground">
              {dict.vendors.subtitle}
            </p>
          </div>
        </div>
        <VendorCreateDialog />
      </div>

      <VendorTable vendors={mapped} />
    </div>
  );
}
