import Link from "next/link";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getOutboundInvoices } from "@/features/generator/actions/outbound-invoice-actions";
import { getDictionary } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  OutboundListClient,
  type OutboundListRow,
} from "@/features/generator/components/outbound/outbound-list-client";
import { Plus, ChevronDown } from "lucide-react";
import { ensureCapOrNotFound } from "@/lib/team/enforce";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";

export default async function OutboundInvoicesPage() {
  const session = await requireGeneratorAccess();
  await ensureCapOrNotFound("view_outbound");

  // Studio is open to every signed-in account, so this page is reachable
  // before a business entity exists. getOutboundInvoices() is entity-scoped
  // and throws in that state — show the setup prompt instead of a 500, the
  // same way /outbound/uniform-structure does.
  const [businessEntity, dict] = await Promise.all([
    getBusinessEntityForUserOrNull(session.user.id),
    getDictionary(),
  ]);
  if (!businessEntity) {
    const u = dict.uniformStructure;
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-2xl font-bold">{dict.shell.creator.nav.invoices}</h1>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">{u.setupBusinessTitle}</p>
          <p className="mt-1 text-amber-900/90">{u.setupBusinessBody}</p>
          <Button asChild className="mt-3" size="sm">
            <Link href="/creator/business-details">{u.setupBusinessCta}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const invoices = await getOutboundInvoices();

  const rows: OutboundListRow[] = invoices.map((inv) => ({
    id: inv.id,
    formattedNumber: inv.formattedNumber,
    documentType: inv.documentType,
    customerName: inv.customerName,
    invoiceDate: inv.invoiceDate,
    total: inv.total,
    outstandingAmount: inv.outstandingAmount,
    paymentState: inv.paymentState,
    currency: inv.currency,
    status: inv.status,
    shaamStatus: inv.shaamStatus,
    allocationNumber: inv.allocationNumber,
    // Legacy marker written into `notes` by the one-off historical import.
    // The string is data that already exists in the database, so it has to
    // stay matched verbatim even though nothing writes it any more.
    isExternalImport: inv.notes?.includes("source=invoice4u") ?? false,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{dict.outbound.list.title}</h1>
          <p className="text-sm text-gray-500">{dict.outbound.list.subtitle}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              {dict.outbound.list.createNew}
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuItem asChild>
              <Link href="/outbound/new">{dict.outbound.list.createTaxInvoice}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/outbound/new?type=TAX_INVOICE_RECEIPT">
                {dict.outbound.list.createTaxInvoiceReceipt}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/outbound/new?type=RECEIPT">
                {dict.outbound.list.createReceipt}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/outbound/new?type=PROFORMA">
                {dict.outbound.list.createProforma}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/outbound/new?type=DELIVERY_NOTE">
                {dict.outbound.list.createDeliveryNote}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/outbound/new-credit">
                {dict.outbound.list.createCreditInvoice}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <h2 className="text-base font-semibold text-gray-800">
              {dict.outbound.list.emptyTitle}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
              {dict.outbound.list.emptyBody}
            </p>
            <Link href="/outbound/new">
              <Button className="mt-4 gap-2">
                <Plus className="h-4 w-4" /> {dict.outbound.list.emptyCta}
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <OutboundListClient invoices={rows} dict={dict} />
      )}
    </div>
  );
}
