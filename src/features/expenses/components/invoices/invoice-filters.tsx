"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

interface InvoiceFiltersProps {
  vendors: { id: string; name: string }[];
  selectedVendorId: string;
  onVendorChange: (vendorId: string) => void;
  selectedStatus: string;
  onStatusChange: (status: string) => void;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedAccountantFilter: string;
  onAccountantFilterChange: (value: string) => void;
}

export function InvoiceFilters({
  vendors,
  selectedVendorId,
  onVendorChange,
  selectedStatus,
  onStatusChange,
  selectedMonth,
  onMonthChange,
  searchQuery,
  onSearchChange,
  selectedAccountantFilter,
  onAccountantFilterChange,
}: InvoiceFiltersProps) {
  const { dict, tag } = useI18n();
  const t = dict.invoices.filters;
  const STATUSES = [
    { value: "all", label: t.allStatuses },
    { value: "pending", label: t.pending },
    { value: "approved", label: t.approved },
    { value: "rejected", label: t.rejected },
    { value: "processing", label: t.processing },
  ];
  const ACCOUNTANT_FILTERS = [
    { value: "all", label: t.accountantFilterAll },
    { value: "sent", label: t.accountantFilterSent },
    { value: "not_sent", label: t.accountantFilterNotSent },
  ];
  const monthOptions: { value: string; label: string }[] = [
    { value: "all", label: t.allMonths },
  ];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString(tag, {
      year: "numeric",
      month: "short",
    });
    monthOptions.push({ value, label });
  }

  return (
    <div className="flex flex-wrap items-stretch gap-2 sm:items-center sm:gap-3">
      {/* Vendor Select */}
      <Select value={selectedVendorId} onValueChange={onVendorChange}>
        <SelectTrigger className="w-full sm:w-[200px]">
          <SelectValue placeholder={t.allVendors} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t.allVendors}</SelectItem>
          {vendors.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status Select */}
      <Select value={selectedStatus} onValueChange={onStatusChange}>
        <SelectTrigger className="w-full flex-1 sm:w-[160px] sm:flex-none">
          <SelectValue placeholder={t.allStatuses} />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Sent to accountant */}
      <Select
        value={selectedAccountantFilter}
        onValueChange={onAccountantFilterChange}
      >
        <SelectTrigger className="w-full flex-1 sm:w-[200px] sm:flex-none">
          <SelectValue placeholder={t.accountantFilterAll} />
        </SelectTrigger>
        <SelectContent>
          {ACCOUNTANT_FILTERS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Month Select */}
      <Select value={selectedMonth} onValueChange={onMonthChange}>
        <SelectTrigger className="w-full flex-1 sm:w-[160px] sm:flex-none">
          <SelectValue placeholder={t.allMonths} />
        </SelectTrigger>
        <SelectContent>
          {monthOptions.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Search Input */}
      <div className="relative w-full sm:w-auto">
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder={t.searchPlaceholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background ps-9 pe-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-[200px]"
        />
      </div>
    </div>
  );
}
