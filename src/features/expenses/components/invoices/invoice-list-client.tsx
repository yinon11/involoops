"use client";

import { useState, useMemo, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InvoiceTable } from "./invoice-table";
import { InvoiceFilters } from "./invoice-filters";
import { useI18n } from "@/lib/i18n/client";

function accountantFilterFromSearchParam(
  raw: string | null,
): "all" | "sent" | "not_sent" {
  if (raw === "sent" || raw === "not_sent") return raw;
  return "all";
}

/** YYYY-MM from invoice document date for list filtering (matches month dropdown values). */
function invoiceIssueYearMonth(invoiceDate: string): string | null {
  const s = invoiceDate?.trim();
  if (!s) return null;
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(s);
  if (match) return `${match[1]}-${match[2]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

interface InvoiceWithType {
  id: string;
  invoiceDate: string;
  vendorName: string;
  vendorId?: string | null;
  suggestedVendorName?: string | null;
  amount: number;
  vatAmount: number | null;
  currency: string;
  invoiceNumber: string | null;
  fileUrl: string | null;
  addedMonth: string;
  status: string;
  type: string;
  sentToAccountantAt: string | null;
  isFixedAsset?: boolean;
  fixedAssetSynced?: boolean;
}

interface InvoiceListClientProps {
  invoices: InvoiceWithType[];
  vendors: { id: string; name: string }[];
}

export function InvoiceListClient({
  invoices,
  vendors,
}: InvoiceListClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { dict } = useI18n();
  const tabsT = dict.invoices.typeTabs;

  const [selectedVendorId, setSelectedVendorId] = useState(
    () => searchParams.get("vendor") ?? "all"
  );
  const [selectedStatus, setSelectedStatus] = useState(
    () => searchParams.get("status") ?? "all"
  );
  const [selectedMonth, setSelectedMonth] = useState(
    () => searchParams.get("month") ?? "all"
  );
  const [searchQuery, setSearchQuery] = useState(
    () => searchParams.get("q") ?? ""
  );
  const [activeTab, setActiveTab] = useState(
    () => searchParams.get("tab") ?? "all"
  );
  const [accountantFilter, setAccountantFilter] = useState<
    "all" | "sent" | "not_sent"
  >(() => accountantFilterFromSearchParam(searchParams.get("accountant")));

  // Sync filter state back to the URL so reloads (and shared links) preserve it.
  useEffect(() => {
    const p = new URLSearchParams();
    if (selectedVendorId !== "all") p.set("vendor", selectedVendorId);
    if (selectedStatus !== "all") p.set("status", selectedStatus);
    if (selectedMonth !== "all") p.set("month", selectedMonth);
    if (searchQuery) p.set("q", searchQuery);
    if (activeTab !== "all") p.set("tab", activeTab);
    if (accountantFilter !== "all") p.set("accountant", accountantFilter);

    const nextQs = p.toString();
    if (nextQs === searchParams.toString()) return;
    router.replace(nextQs ? `${pathname}?${nextQs}` : pathname, {
      scroll: false,
    });
  }, [
    selectedVendorId,
    selectedStatus,
    selectedMonth,
    searchQuery,
    activeTab,
    accountantFilter,
    pathname,
    router,
    searchParams,
  ]);

  const filtered = useMemo(() => {
    let result = invoices;

    if (activeTab === "expenses") {
      result = result.filter((i) => i.type === "expense");
    } else if (activeTab === "income") {
      result = result.filter((i) => i.type === "income");
    }

    if (selectedVendorId !== "all") {
      const vendorName = vendors.find((v) => v.id === selectedVendorId)?.name;
      if (vendorName) {
        result = result.filter((i) => i.vendorName === vendorName);
      }
    }

    if (selectedStatus !== "all") {
      result = result.filter((i) => i.status === selectedStatus);
    }

    if (accountantFilter === "sent") {
      result = result.filter((i) => Boolean(i.sentToAccountantAt));
    } else if (accountantFilter === "not_sent") {
      result = result.filter((i) => !i.sentToAccountantAt);
    }

    if (selectedMonth !== "all") {
      result = result.filter(
        (i) => invoiceIssueYearMonth(i.invoiceDate) === selectedMonth
      );
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.invoiceNumber?.toLowerCase().includes(q) ||
          i.vendorName.toLowerCase().includes(q)
      );
    }

    return result;
  }, [
    invoices,
    activeTab,
    selectedVendorId,
    selectedStatus,
    accountantFilter,
    selectedMonth,
    searchQuery,
    vendors,
  ]);

  return (
    <div className="space-y-4">
      <InvoiceFilters
        vendors={vendors}
        selectedVendorId={selectedVendorId}
        onVendorChange={setSelectedVendorId}
        selectedStatus={selectedStatus}
        onStatusChange={setSelectedStatus}
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedAccountantFilter={accountantFilter}
        onAccountantFilterChange={(v) =>
          setAccountantFilter(accountantFilterFromSearchParam(v))
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">
            {tabsT.all.replace("{count}", String(invoices.length))}
          </TabsTrigger>
          <TabsTrigger value="expenses">
            {tabsT.expenses.replace(
              "{count}",
              String(invoices.filter((i) => i.type === "expense").length),
            )}
          </TabsTrigger>
          <TabsTrigger value="income">
            {tabsT.income.replace(
              "{count}",
              String(invoices.filter((i) => i.type === "income").length),
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <InvoiceTable
            invoices={filtered}
            showDelete
            showStatusActions
            downloadRequiresSelection={false}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
