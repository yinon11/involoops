"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  type SortingState,
  type RowSelectionState,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type Row,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Merge,
  Search,
  X,
} from "lucide-react";
import { VendorMergeDialog } from "@/features/expenses/components/vendors/vendor-merge-dialog";
import { ExportXlsxButton } from "@/components/shared/export-xlsx-button";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries";

interface VendorRow {
  id: string;
  name: string;
  aliases: string[];
  defaultCategory: string | null;
  isIncomeSource: boolean | null;
  invoiceCount: number;
  createdAt: Date | null;
}

const nameAliasFilter: FilterFn<VendorRow> = (row, _columnId, filterValue) => {
  const query = String(filterValue ?? "").trim().toLowerCase();
  if (!query) return true;
  const name = row.original.name?.toLowerCase() ?? "";
  if (name.includes(query)) return true;
  return (row.original.aliases ?? []).some((a) =>
    a.toLowerCase().includes(query)
  );
};

const incomeFilter: FilterFn<VendorRow> = (
  row: Row<VendorRow>,
  _columnId,
  filterValue
) => {
  if (filterValue === "all" || filterValue == null) return true;
  const isIncome = !!row.original.isIncomeSource;
  return filterValue === "income" ? isIncome : !isIncome;
};

const categoryEqualsFilter: FilterFn<VendorRow> = (
  row,
  _columnId,
  filterValue
) => {
  if (!filterValue) return true;
  return row.original.defaultCategory === filterValue;
};

function buildColumns(
  t: Dictionary["vendors"]["table"],
): ColumnDef<VendorRow>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          aria-label={t.selectAllAria}
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={t.selectRowAria.replace("{name}", row.original.name)}
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
    },
    {
      accessorKey: "name",
      filterFn: nameAliasFilter,
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ms-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {t.headerName}
          <ArrowUpDown className="ms-1 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const id = row.original.id;
        const name = row.getValue("name") as string;
        const aliases = row.original.aliases ?? [];
        return (
          <div className="space-y-0.5">
            <Link
              href={`/vendors/${id}`}
              className="font-medium text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {name}
            </Link>
            {aliases.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {t.aliasPrefix} {aliases.join(", ")}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "defaultCategory",
      filterFn: categoryEqualsFilter,
      header: t.headerCategory,
      cell: ({ row }) => {
        const cat = row.getValue("defaultCategory") as string | null;
        return cat ? (
          <Badge variant="outline">{cat}</Badge>
        ) : (
          <span className="text-muted-foreground">--</span>
        );
      },
    },
    {
      accessorKey: "invoiceCount",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ms-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {t.headerInvoices}
          <ArrowUpDown className="ms-1 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm">{row.getValue("invoiceCount")}</span>
      ),
    },
    {
      accessorKey: "isIncomeSource",
      filterFn: incomeFilter,
      header: t.headerIncomeSource,
      cell: ({ row }) => {
        const isIncome = row.getValue("isIncomeSource") as boolean | null;
        return isIncome ? (
          <Badge className="bg-green-100 text-green-800">{t.incomeBadge}</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">{t.noBadge}</span>
        );
      },
    },
  ];
}

interface VendorTableProps {
  vendors: VendorRow[];
}

export function VendorTable({ vendors }: VendorTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { dict } = useI18n();
  const t = dict.vendors.table;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [mergeOpen, setMergeOpen] = useState(false);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [categoryFilter, setCategoryFilter] = useState<string>(
    () => searchParams.get("category") ?? "all"
  );
  const [incomeFilterValue, setIncomeFilterValue] = useState<string>(
    () => searchParams.get("type") ?? "all"
  );

  const columns = useMemo(() => buildColumns(t), [t]);

  // Sync filter state back to the URL so reloads (and shared links) preserve it.
  useEffect(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("q", search);
    if (categoryFilter !== "all") p.set("category", categoryFilter);
    if (incomeFilterValue !== "all") p.set("type", incomeFilterValue);

    const nextQs = p.toString();
    if (nextQs === searchParams.toString()) return;
    router.replace(nextQs ? `${pathname}?${nextQs}` : pathname, {
      scroll: false,
    });
  }, [search, categoryFilter, incomeFilterValue, pathname, router, searchParams]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of vendors) {
      if (v.defaultCategory) set.add(v.defaultCategory);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [vendors]);

  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const filters: ColumnFiltersState = [];
    if (search.trim()) filters.push({ id: "name", value: search });
    if (categoryFilter !== "all") {
      filters.push({ id: "defaultCategory", value: categoryFilter });
    }
    if (incomeFilterValue !== "all") {
      filters.push({ id: "isIncomeSource", value: incomeFilterValue });
    }
    return filters;
  }, [search, categoryFilter, incomeFilterValue]);

  const hasActiveFilters =
    search.trim().length > 0 ||
    categoryFilter !== "all" ||
    incomeFilterValue !== "all";

  const table = useReactTable({
    data: vendors,
    columns,
    state: { sorting, rowSelection, columnFilters },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: {
      pagination: { pageSize: 20 },
    },
  });

  // Reset to first page whenever filters change so users see results.
  useEffect(() => {
    table.setPageIndex(0);
  }, [search, categoryFilter, incomeFilterValue, table]);

  const filteredRows = table.getFilteredRowModel().rows;
  const totalInvoiceCount = useMemo(
    () => filteredRows.reduce((sum, r) => sum + (r.original.invoiceCount ?? 0), 0),
    [filteredRows]
  );

  const selectedRows = table.getSelectedRowModel().rows;
  const mergeCandidates = useMemo(
    () =>
      selectedRows.map((r) => ({
        id: r.original.id,
        name: r.original.name,
        invoiceCount: r.original.invoiceCount,
      })),
    [selectedRows]
  );
  const canMerge = mergeCandidates.length >= 2;

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setIncomeFilterValue("all");
  };

  const buildExportRows = () =>
    filteredRows.map((r) => {
      const v = r.original;
      return {
        [t.exportColName]: v.name,
        [t.exportColAliases]: (v.aliases ?? []).join(", "),
        [t.exportColCategory]: v.defaultCategory ?? "",
        [t.exportColIncome]: v.isIncomeSource ? t.exportYes : t.exportNo,
        [t.exportColInvoices]: v.invoiceCount ?? 0,
        [t.exportColCreatedAt]: v.createdAt
          ? new Date(v.createdAt).toISOString().slice(0, 10)
          : "",
      };
    });

  const totalRows = table.getFilteredRowModel().rows.length;
  const totalLabel =
    totalRows === 1
      ? t.countOne
      : t.countMany.replace("{count}", String(totalRows));
  const selectedLabel =
    selectedRows.length === 1
      ? t.selectedOne
      : t.selectedMany.replace("{count}", String(selectedRows.length));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="ps-9"
            aria-label={t.searchAriaLabel}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="sm:w-[180px]" aria-label={t.categoryAriaLabel}>
            <SelectValue placeholder={t.categoryPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.categoryAll}</SelectItem>
            {categoryOptions.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={incomeFilterValue}
          onValueChange={setIncomeFilterValue}
        >
          <SelectTrigger className="sm:w-[160px]" aria-label={t.typeAriaLabel}>
            <SelectValue placeholder={t.typePlaceholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.typeAll}</SelectItem>
            <SelectItem value="income">{t.typeIncome}</SelectItem>
            <SelectItem value="expense">{t.typeExpense}</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="me-1 h-4 w-4" />
            {t.clear}
          </Button>
        )}
        <ExportXlsxButton
          rows={buildExportRows}
          filename={t.exportFilename}
          sheetName={t.exportSheet}
          disabled={filteredRows.length === 0}
        />
      </div>

      {selectedRows.length > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-sm">{selectedLabel}</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRowSelection({})}
            >
              {t.clear}
            </Button>
            <Button
              size="sm"
              disabled={!canMerge}
              onClick={() => setMergeOpen(true)}
            >
              <Merge className="me-1 h-4 w-4" />
              {t.mergeSelected}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={() => router.push(`/vendors/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {t.empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {filteredRows.length > 0 && (
            <TableFooter>
              <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                <TableCell colSpan={3}>{t.total}</TableCell>
                <TableCell className="text-sm">{totalInvoiceCount}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{totalLabel}</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
            {t.previous}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t.pageOf
              .replace(
                "{current}",
                String(table.getState().pagination.pageIndex + 1),
              )
              .replace("{total}", String(table.getPageCount()))}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {t.next}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <VendorMergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        candidates={mergeCandidates}
        onMerged={() => {
          setRowSelection({});
        }}
      />
    </div>
  );
}
