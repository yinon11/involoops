import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getCustomersWithStats } from "@/features/generator/actions/customer-actions";
import { getDictionary } from "@/lib/i18n/server";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerCreateDialog } from "@/features/generator/components/customers/customer-create-dialog";
import {
  CustomerListClient,
  type CustomerRow,
} from "@/features/generator/components/customers/customer-list-client";
import { Users } from "lucide-react";
import { ensureCapOrNotFound } from "@/lib/team/enforce";

export const metadata = {
  title: "Customers",
  robots: { index: false, follow: false },
};

export default async function CustomersPage() {
  await requireGeneratorAccess();
  await ensureCapOrNotFound("view_customers");

  const [customers, dict] = await Promise.all([
    getCustomersWithStats(),
    getDictionary(),
  ]);

  const rows: CustomerRow[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    taxId: c.taxId,
    invoiceCount: c.invoiceCount ?? 0,
  }));

  const L = dict.customers;

  const createDialogLabels = {
    triggerLabel: L.list.addCustomer,
    title: L.create.title,
    description: L.create.description,
    namePh: L.create.namePh,
    emailPh: L.create.emailPh,
    phonePh: L.create.phonePh,
    taxIdPh: L.create.taxIdPh,
    addressPh: L.create.addressPh,
    notesPh: L.create.notesPh,
    submit: L.create.submit,
    submitting: L.create.submitting,
    cancel: L.create.cancel,
    errorNameRequired: L.create.errors.nameRequired,
    errorCreateFailed: L.create.errors.createFailed,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-violet-600" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {L.list.title}
            </h1>
            <p className="text-sm text-muted-foreground">{L.list.subtitle}</p>
          </div>
        </div>
        <CustomerCreateDialog labels={createDialogLabels} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Users className="h-8 w-8 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-800">
              {L.list.emptyTitle}
            </h2>
            <p className="mx-auto max-w-md text-sm text-slate-500">
              {L.list.emptyBody}
            </p>
            <CustomerCreateDialog
              labels={{ ...createDialogLabels, triggerLabel: L.list.emptyCta }}
            />
          </CardContent>
        </Card>
      ) : (
        <CustomerListClient
          customers={rows}
          labels={{
            searchPlaceholder: L.list.searchPlaceholder,
            clear: L.list.clear,
            noResults: L.list.noResults,
            totalCountTemplate: L.list.totalCount,
            cols: L.list.cols,
          }}
        />
      )}
    </div>
  );
}
