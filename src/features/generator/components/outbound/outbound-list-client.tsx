"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentStatusChip } from "@/features/generator/components/outbound/document-status-chip";
import {
  FilterBar,
  FilterChip,
  FilterGroup,
  MultiSelectFilter,
  filterInputClassName,
} from "@/components/dashboard/filter-bar";
import { Receipt, Trash2, Loader2, Search } from "lucide-react";
import { displayDocumentNumber } from "@/lib/documents/display-number";
import { deleteOutboundInvoice } from "@/features/generator/actions/outbound-invoice-actions";
import type { Dictionary } from "@/lib/i18n";
import { format } from "@/lib/i18n";
import type { OutboundInvoiceStatus } from "@/db/schema/outbound-invoices";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/documents/types";
import type { OutboundPaymentState } from "@/lib/outbound/operations";

export interface OutboundListRow {
  id: string;
  formattedNumber: string | null;
  documentType: DocumentType;
  customerName: string | null;
  invoiceDate: string;
  total: string;
  outstandingAmount: string;
  paymentState: OutboundPaymentState;
  currency: string | null;
  status: OutboundInvoiceStatus | null;
  shaamStatus: string | null;
  allocationNumber: string | null;
  /** Historical row imported from a previous system — not issued here. */
  isExternalImport?: boolean;
}

interface Props {
  invoices: OutboundListRow[];
  dict: Dictionary;
}

type PaymentFilter = "all" | "open" | "paid";
type ItaFilter = "all" | "approved" | "pending" | "problem" | "none";

const STATUSES: OutboundInvoiceStatus[] = [
  "draft",
  "issued",
  "sent",
  "paid",
  "voided",
];

/**
 * Client-side filter + table for /outbound. The server already derived
 * `paymentState`; every other slice (type, status, date, customer, ITA,
 * text) is applied here so the chips stay instant.
 */
export function OutboundListClient({ invoices, dict }: Props) {
  const F = dict.outbound.list.filters;
  const [search, setSearch] = useState("");
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [statuses, setStatuses] = useState<OutboundInvoiceStatus[]>([]);
  const [payment, setPayment] = useState<PaymentFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ita, setIta] = useState<ItaFilter>("all");
  const [customers, setCustomers] = useState<string[]>([]);

  const { openCount, openTotal, openCurrency } = useMemo(() => {
    let count = 0;
    let total = 0;
    let currency = "";
    for (const inv of invoices) {
      if (inv.paymentState !== "open" && inv.paymentState !== "partial") continue;
      count += 1;
      total += Number(inv.outstandingAmount);
      if (!currency) currency = inv.currency ?? "ILS";
    }
    return { openCount: count, openTotal: total, openCurrency: currency || "ILS" };
  }, [invoices]);

  const problemCount = useMemo(
    () => invoices.filter((inv) => matchesIta(inv.shaamStatus, "problem")).length,
    [invoices],
  );

  const customerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const inv of invoices) {
      if (inv.customerName) names.add(inv.customerName);
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ id: name, name }));
  }, [invoices]);

  const typeOptions = DOCUMENT_TYPES.map((type) => ({
    id: type,
    name: dict.documents.type[type],
  }));

  const statusOptions = STATUSES.map((status) => ({
    id: status,
    name: dict.outbound.status[status],
  }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (types.length > 0 && !types.includes(inv.documentType)) return false;
      if (statuses.length > 0 && !statuses.includes(inv.status ?? "draft")) return false;
      if (customers.length > 0 && !customers.includes(inv.customerName ?? "")) return false;
      if (payment === "open" && inv.paymentState !== "open" && inv.paymentState !== "partial") {
        return false;
      }
      if (payment === "paid" && inv.paymentState !== "paid" && inv.status !== "paid") {
        return false;
      }
      if (from && inv.invoiceDate < from) return false;
      if (to && inv.invoiceDate > to) return false;
      if (!matchesIta(inv.shaamStatus, ita)) return false;
      if (!q) return true;
      const haystack = [
        inv.formattedNumber,
        inv.customerName,
        inv.allocationNumber,
        `draft-${inv.id.slice(0, 8)}`,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [invoices, search, types, statuses, customers, payment, from, to, ita]);

  const filtersActive =
    search.trim() !== "" ||
    types.length > 0 ||
    statuses.length > 0 ||
    customers.length > 0 ||
    payment !== "all" ||
    from !== "" ||
    to !== "" ||
    ita !== "all";

  function clearFilters() {
    setSearch("");
    setTypes([]);
    setStatuses([]);
    setCustomers([]);
    setPayment("all");
    setFrom("");
    setTo("");
    setIta("all");
  }

  function toggle<T extends string>(list: T[], id: T, set: (next: T[]) => void) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function multiLabel(
    selected: string[],
    options: { id: string; name: string }[],
  ) {
    if (selected.length === 0) return F.any;
    if (selected.length === 1) {
      return options.find((o) => o.id === selected[0])?.name ?? F.any;
    }
    return format(F.selectedCount, { count: String(selected.length) });
  }

  return (
    <>
      <FilterBar
        trailing={
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {format(F.showing, {
                count: String(filtered.length),
                total: String(invoices.length),
              })}
            </span>
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                {F.clear}
              </Button>
            )}
          </div>
        }
      >
        <FilterGroup label={F.search}>
          <div className="relative">
            <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={F.searchPlaceholder}
              className={`${filterInputClassName} w-56 ps-7`}
            />
          </div>
        </FilterGroup>

        <FilterGroup label={F.type}>
          <MultiSelectFilter
            buttonLabel={multiLabel(types, typeOptions)}
            selectedCount={types.length}
            options={typeOptions}
            selectedIds={types}
            onToggle={(id) => toggle(types, id as DocumentType, setTypes)}
            onClear={() => setTypes([])}
            searchPlaceholder={F.searchOptions}
            emptyLabel={F.noneFound}
            clearLabel={F.clear}
          />
        </FilterGroup>

        <FilterGroup label={F.status}>
          <MultiSelectFilter
            buttonLabel={multiLabel(statuses, statusOptions)}
            selectedCount={statuses.length}
            options={statusOptions}
            selectedIds={statuses}
            onToggle={(id) =>
              toggle(statuses, id as OutboundInvoiceStatus, setStatuses)
            }
            onClear={() => setStatuses([])}
            searchPlaceholder={F.searchOptions}
            emptyLabel={F.noneFound}
            clearLabel={F.clear}
          />
        </FilterGroup>

        <FilterGroup label={F.payment}>
          <FilterChip selected={payment === "all"} onClick={() => setPayment("all")}>
            {dict.outbound.list.filterAll}
          </FilterChip>
          <FilterChip
            selected={payment === "open"}
            onClick={() => setPayment(payment === "open" ? "all" : "open")}
          >
            {openCount > 0
              ? format(dict.outbound.list.filterOpenCount, {
                  count: String(openCount),
                  amount: openTotal.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }),
                  currency: openCurrency,
                })
              : dict.outbound.list.filterOpen}
          </FilterChip>
          <FilterChip
            selected={payment === "paid"}
            onClick={() => setPayment(payment === "paid" ? "all" : "paid")}
          >
            {F.paid}
          </FilterChip>
        </FilterGroup>

        <FilterGroup label={F.when}>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            {F.from}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={filterInputClassName}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            {F.to}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={filterInputClassName}
            />
          </label>
        </FilterGroup>

        <FilterGroup label={F.ita}>
          {(
            [
              ["all", dict.outbound.list.filterAll],
              ["approved", F.itaApproved],
              ["pending", F.itaPending],
              [
                "problem",
                problemCount > 0
                  ? `${F.itaProblem} (${problemCount})`
                  : F.itaProblem,
              ],
              ["none", F.itaNone],
            ] as const
          ).map(([value, label]) => (
            <FilterChip
              key={value}
              selected={ita === value}
              onClick={() => setIta(value)}
            >
              {label}
            </FilterChip>
          ))}
        </FilterGroup>

        {customerOptions.length > 0 && (
          <FilterGroup label={F.customer}>
            <MultiSelectFilter
              buttonLabel={multiLabel(customers, customerOptions)}
              selectedCount={customers.length}
              options={customerOptions}
              selectedIds={customers}
              onToggle={(id) => toggle(customers, id, setCustomers)}
              onClear={() => setCustomers([])}
              searchPlaceholder={F.searchOptions}
              emptyLabel={F.noneFound}
              clearLabel={F.clear}
            />
          </FilterGroup>
        )}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          {/* Borders live on the cells so wrapped text stays above the
              row line. The ITA cell is only the last 9 digits — the full
              allocation number is one unbreakable string and was forcing
              the row to scroll. */}
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-gray-50 text-start text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="border-b px-4 py-3">{dict.outbound.list.invoiceNumberColumn}</th>
                <th className="border-b px-4 py-3">{dict.documents.type.label}</th>
                <th className="border-b px-4 py-3">{dict.outbound.list.customerColumn}</th>
                <th className="border-b px-4 py-3">{dict.outbound.list.dateColumn}</th>
                <th className="border-b px-4 py-3 text-end">{dict.outbound.list.totalColumn}</th>
                <th className="border-b px-4 py-3 text-end">
                  {dict.outbound.list.outstandingColumn}
                </th>
                <th className="border-b px-4 py-3">{dict.outbound.list.statusColumn}</th>
                <th className="border-b px-4 py-3">{dict.outbound.list.shaamColumn}</th>
                <th className="border-b px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                    {F.noMatches}
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="border-b px-4 py-3 font-mono font-medium">
                    {displayDocumentNumber(inv)}
                  </td>
                  <td className="border-b px-4 py-3">
                    <Badge
                      variant="secondary"
                      className="bg-indigo-50 text-indigo-700"
                    >
                      {dict.documents.type[inv.documentType]}
                    </Badge>
                  </td>
                  <td className="border-b px-4 py-3">{inv.customerName ?? "—"}</td>
                  <td className="border-b px-4 py-3">{inv.invoiceDate}</td>
                  <td className="border-b px-4 py-3 text-end font-medium tabular-nums">
                    {Number(inv.total).toLocaleString()} {inv.currency}
                  </td>
                  <td className="border-b px-4 py-3 text-end font-medium tabular-nums">
                    <OutstandingCell row={inv} dict={dict} />
                  </td>
                  <td className="border-b px-4 py-3">
                    <DocumentStatusChip
                      status={inv.status ?? "draft"}
                      importedFromExternal={inv.isExternalImport}
                      shaamStatus={
                        inv.shaamStatus as
                          | "NOT_APPLICABLE"
                          | "NOT_REQUIRED"
                          | "PENDING"
                          | "APPROVED"
                          | "REJECTED"
                          | "HELD"
                          | "OUTAGE_ISSUED"
                          | "ISSUED_WITHOUT_ALLOCATION"
                          | "CANCELLED_AFTER_REJECTION"
                          | "UNRESOLVED"
                          | null
                      }
                      dict={dict}
                      partial={inv.paymentState === "partial"}
                    />
                  </td>
                  <td className="border-b px-4 py-3">
                    <ShaamCell
                      shaamStatus={inv.shaamStatus}
                      allocationNumber={inv.allocationNumber}
                      labels={{
                        approved: dict.outbound.list.shaamApprovedShort,
                        pending: dict.outbound.list.shaamPendingShort,
                        rejected: dict.outbound.list.shaamRejectedShort,
                        unresolved: dict.outbound.list.shaamUnresolvedShort,
                        withoutAllocation:
                          dict.outbound.list.shaamNoAllocationShort,
                        cancelled: dict.outbound.list.shaamCancelledShort,
                      }}
                    />
                  </td>
                  <td className="border-b px-4 py-3 text-end">
                    <div className="flex items-center justify-end gap-2">
                      {(inv.paymentState === "open" ||
                        inv.paymentState === "partial") && (
                        <Link
                          href={`/outbound/new?type=RECEIPT&forInvoiceId=${inv.id}`}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                          >
                            <Receipt className="h-3 w-3" />
                            {dict.outbound.list.issueReceiptInline}
                          </Button>
                        </Link>
                      )}
                      <Link href={`/outbound/${inv.id}`}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                      {(inv.status ?? "draft") === "draft" && !inv.formattedNumber && (
                        <DeleteDraftButton id={inv.id} dict={dict} />
                      )}
                    </div>
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function DeleteDraftButton({ id, dict }: { id: string; dict: Dictionary }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    toast(dict.outbound.list.deleteDraftConfirm, {
      action: {
        label: dict.outbound.list.deleteDraft,
        onClick: () => {
          startTransition(async () => {
            try {
              await deleteOutboundInvoice(id);
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
            }
          });
        },
      },
      cancel: { label: dict.common.cancel, onClick: () => {} },
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleDelete}
      disabled={isPending}
      className="gap-1 text-red-600 hover:bg-red-50 hover:text-red-700"
      aria-label={dict.outbound.list.deleteDraft}
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Trash2 className="h-3 w-3" />
      )}
      {dict.outbound.list.deleteDraft}
    </Button>
  );
}

function OutstandingCell({
  row,
  dict,
}: {
  row: OutboundListRow;
  dict: Dictionary;
}) {
  // Only TAX_INVOICE rows carry a meaningful balance; everything else
  // shows the dash. Same for paid / voided / draft TI rows where the
  // outstanding concept doesn't apply on this surface.
  if (
    row.paymentState === "n_a" ||
    row.paymentState === "voided" ||
    row.paymentState === "draft" ||
    row.paymentState === "paid"
  ) {
    return (
      <span className="text-xs text-gray-400">
        {dict.outbound.list.outstandingNa}
      </span>
    );
  }
  const cls =
    row.paymentState === "partial" ? "text-amber-700" : "text-rose-700";
  return (
    <span className={cls}>
      {Number(row.outstandingAmount).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}{" "}
      {row.currency}
    </span>
  );
}

function matchesIta(status: string | null, filter: ItaFilter): boolean {
  if (filter === "all") return true;
  if (filter === "approved") return status === "APPROVED";
  if (filter === "pending") return status === "PENDING" || status === "OUTAGE_ISSUED";
  if (filter === "problem") {
    return (
      status === "REJECTED" ||
      status === "HELD" ||
      // Our retries ran out. Nothing was refused, but the document still
      // has no allocation number and somebody has to look at it.
      status === "UNRESOLVED"
    );
  }
  return !status || status === "NOT_APPLICABLE" || status === "NOT_REQUIRED";
}

function ShaamCell({
  shaamStatus,
  allocationNumber,
  labels,
}: {
  shaamStatus: string | null;
  allocationNumber: string | null;
  labels: {
    approved: string;
    pending: string;
    rejected: string;
    unresolved: string;
    withoutAllocation: string;
    cancelled: string;
  };
}) {
  if (
    !shaamStatus ||
    shaamStatus === "NOT_APPLICABLE" ||
    shaamStatus === "NOT_REQUIRED"
  ) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  if (shaamStatus === "APPROVED" && allocationNumber) {
    const last9 =
      allocationNumber.length > 9
        ? allocationNumber.slice(-9)
        : allocationNumber;
    return (
      <span className="font-mono text-xs font-semibold text-green-800" title={allocationNumber}>
        {last9}
      </span>
    );
  }
  if (shaamStatus === "PENDING" || shaamStatus === "OUTAGE_ISSUED") {
    return <span className="text-xs text-amber-700">{labels.pending}</span>;
  }
  if (shaamStatus === "REJECTED" || shaamStatus === "HELD") {
    return <span className="text-xs text-red-700">{labels.rejected}</span>;
  }
  if (shaamStatus === "UNRESOLVED") {
    return <span className="text-xs text-amber-700">{labels.unresolved}</span>;
  }
  if (shaamStatus === "ISSUED_WITHOUT_ALLOCATION") {
    return (
      <span className="text-xs text-amber-700">{labels.withoutAllocation}</span>
    );
  }
  if (shaamStatus === "CANCELLED_AFTER_REJECTION") {
    return <span className="text-xs text-gray-500">{labels.cancelled}</span>;
  }
  return <span className="text-xs text-gray-400">{shaamStatus}</span>;
}
