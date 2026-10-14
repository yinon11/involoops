"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
  type RowSelectionState,
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createInvoiceColumns, type InvoiceRow } from "./invoice-columns";
import {
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  InvoiceReextractProvider,
  type InvoiceReextractOnComplete,
} from "./invoice-reextract-context";
import {
  bulkApprove,
  bulkMarkNotSentToAccountant,
  bulkMarkSentToAccountant,
} from "@/features/expenses/actions/invoice-actions";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { InvoiceTableToolbar } from "./invoice-table-toolbar";
import { useT } from "@/lib/i18n/client";

interface InvoiceTableProps {
  invoices: InvoiceRow[];
  /** After re-extract (e.g. dashboard: refetch with current filters). Defaults to router.refresh(). */
  onReExtractComplete?: InvoiceReextractOnComplete;
  /** Show per-row delete with confirmation (invoices list only). */
  showDelete?: boolean;
  /** Invoices list: inline status dropdown (approve / reject / pending). */
  showStatusActions?: boolean;
  /** Approve + sent-to-accountant bulk actions in the toolbar. Default true. */
  showBulkToolbar?: boolean;
  /**
   * When true, spreadsheet + file download require at least one selected row.
   * Default true (dashboard, vendor, income). Main invoices list sets false
   * so users can download all filtered rows without selecting.
   */
  downloadRequiresSelection?: boolean;
  /** After bulk approve / accountant bulk when client holds invoice rows (dashboard / income). */
  onAfterBulkMutation?: () => void | Promise<void>;
}

export function InvoiceTable({
  invoices,
  onReExtractComplete,
  showDelete = false,
  showStatusActions = false,
  showBulkToolbar = true,
  downloadRequiresSelection = true,
  onAfterBulkMutation,
}: InvoiceTableProps) {
  const router = useRouter();
  const refreshAfterBulkMutation = useCallback(async () => {
    await onAfterBulkMutation?.();
    router.refresh();
  }, [onAfterBulkMutation, router]);
  const dict = useT();
  const t = dict.invoices.table;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkWorking, setBulkWorking] = useState<
    null | "approve" | "accountant-sent" | "accountant-unsent"
  >(null);

  const tableColumns = useMemo(() => {
    const base = createInvoiceColumns({ showDelete, showStatusActions, dict });

    const accountantMarkColumn: ColumnDef<InvoiceRow> = {
      id: "accountantSent",
      header: () => (
        <span className="sr-only">{t.colAccountantMark}</span>
      ),
      cell: ({ row }) =>
        row.original.sentToAccountantAt ? (
          <span
            className="inline-flex justify-center text-emerald-600 dark:text-emerald-400"
            title={t.colAccountantMark}
            aria-label={t.colAccountantMark}
          >
            <Check className="size-3 shrink-0" strokeWidth={2.75} aria-hidden />
          </span>
        ) : (
          <span className="inline-flex size-3 shrink-0" aria-hidden />
        ),
      enableSorting: false,
      size: 20,
    };

    const selectColumn: ColumnDef<InvoiceRow> = {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label={t.selectAllPage}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label={t.selectRow.replace("{name}", row.original.vendorName)}
        />
      ),
      enableSorting: false,
      size: 40,
    };

    return [accountantMarkColumn, selectColumn, ...base];
  }, [showDelete, showStatusActions, dict, t]);

  const table = useReactTable({
    data: invoices,
    columns: tableColumns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 20 },
    },
  });

  const selectedRows = table.getSelectedRowModel().rows;
  const pendingInSelection = selectedRows.filter(
    (r) => r.original.status === "pending"
  ).length;
  const downloadCount = downloadRequiresSelection
    ? selectedRows.length
    : selectedRows.length > 0
      ? selectedRows.length
      : invoices.length;
  const downloadLabelCount =
    downloadRequiresSelection || selectedRows.length > 0
      ? downloadCount
      : undefined;
  const downloadIds = useCallback(() => {
    if (downloadRequiresSelection) {
      return selectedRows.map((r) => r.original.id);
    }
    if (selectedRows.length > 0) {
      return selectedRows.map((r) => r.original.id);
    }
    return invoices.map((inv) => inv.id);
  }, [downloadRequiresSelection, selectedRows, invoices]);

  const unsentInSelection = useMemo(
    () =>
      selectedRows.filter((r) => !r.original.sentToAccountantAt).length,
    [selectedRows]
  );

  const sentInSelection = useMemo(
    () =>
      selectedRows.filter((r) => Boolean(r.original.sentToAccountantAt)).length,
    [selectedRows]
  );

  // Sum Amount and VAT over currently-filtered rows, grouped by currency
  // (invoices can be in different currencies).
  const filteredRows = table.getFilteredRowModel().rows;
  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, { amount: number; vat: number }>();
    for (const r of filteredRows) {
      const cur = r.original.currency || "—";
      const entry = map.get(cur) ?? { amount: 0, vat: 0 };
      entry.amount += r.original.amount ?? 0;
      entry.vat += r.original.vatAmount ?? 0;
      map.set(cur, entry);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRows]);

  const amountColIdx = tableColumns.findIndex(
    (c) => "accessorKey" in c && c.accessorKey === "amount"
  );
  const vatColIdx = tableColumns.findIndex(
    (c) => "accessorKey" in c && c.accessorKey === "vatAmount"
  );
  const trailingColCount = tableColumns.length - Math.max(amountColIdx, vatColIdx) - 1;

  const allFilteredSelected = useMemo(
    () =>
      invoices.length > 0 &&
      invoices.every((inv) => Boolean(rowSelection[inv.id])),
    [invoices, rowSelection]
  );

  const toggleSelectAllFiltered = useCallback(() => {
    if (allFilteredSelected) {
      setRowSelection({});
      return;
    }
    const next: RowSelectionState = {};
    for (const inv of invoices) {
      next[inv.id] = true;
    }
    setRowSelection(next);
  }, [allFilteredSelected, invoices]);

  const clearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const buildExportRows = useCallback(() => {
    return Object.keys(rowSelection)
      .filter((id) => rowSelection[id])
      .map((id) => invoices.find((inv) => inv.id === id))
      .filter((inv): inv is InvoiceRow => inv != null)
      .map((inv) => ({
        "Invoice Number": inv.invoiceNumber ?? "",
        "Invoice Date": inv.invoiceDate ?? "",
        Vendor: inv.vendorName ?? "",
        Status: inv.status ?? "",
        Amount: inv.amount ?? 0,
        Currency: inv.currency ?? "",
        "VAT Amount": inv.vatAmount ?? 0,
        "Uploaded Month": inv.addedMonth ?? "",
        "Sent to accountant": inv.sentToAccountantAt ? "Yes" : "No",
      }));
  }, [rowSelection, invoices]);

  const handleBulkApprove = useCallback(async () => {
    if (selectedRows.length === 0) return;
    const pendingIds = selectedRows
      .map((r) => r.original)
      .filter((inv) => inv.status === "pending")
      .map((inv) => inv.id);

    if (pendingIds.length === 0) {
      toast.error(t.noPendingInSelection);
      return;
    }

    setBulkWorking("approve");
    try {
      const result = await bulkApprove(pendingIds);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      let msg = t.bulkApproveResult.replace(
        "{approved}",
        result.approved.toString()
      );
      if (result.skipped > 0) {
        msg += t.bulkApproveSkipped.replace(
          "{skipped}",
          result.skipped.toString()
        );
      }
      toast.success(msg);
      setRowSelection({});
      await refreshAfterBulkMutation();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t.bulkApproveFailed
      );
    } finally {
      setBulkWorking(null);
    }
  }, [selectedRows, t, refreshAfterBulkMutation]);

  const handleBulkMarkSentToAccountant = useCallback(async () => {
    if (selectedRows.length === 0 || unsentInSelection === 0) return;

    const ids = selectedRows.map((r) => r.original.id);
    setBulkWorking("accountant-sent");
    try {
      const result = await bulkMarkSentToAccountant(ids);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (result.updated === 0) {
        toast.message(t.accountantNothingToMarkSent);
      } else {
        toast.success(
          t.accountantMarkedToast.replace(
            "{count}",
            result.updated.toString()
          )
        );
      }
      setRowSelection({});
      await refreshAfterBulkMutation();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t.accountantBulkFailed
      );
    } finally {
      setBulkWorking(null);
    }
  }, [selectedRows, unsentInSelection, t, refreshAfterBulkMutation]);

  const handleBulkMarkNotSentToAccountant = useCallback(async () => {
    if (selectedRows.length === 0 || sentInSelection === 0) return;

    const ids = selectedRows.map((r) => r.original.id);
    setBulkWorking("accountant-unsent");
    try {
      const result = await bulkMarkNotSentToAccountant(ids);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (result.updated === 0) {
        toast.message(t.accountantNothingToUnmark);
      } else {
        toast.success(
          t.accountantUnmarkedToast.replace(
            "{count}",
            result.updated.toString()
          )
        );
      }
      setRowSelection({});
      await refreshAfterBulkMutation();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t.accountantBulkFailed
      );
    } finally {
      setBulkWorking(null);
    }
  }, [selectedRows, sentInSelection, t, refreshAfterBulkMutation]);

  return (
    <InvoiceReextractProvider onComplete={onReExtractComplete}>
      <div className="space-y-4">
        {invoices.length > 0 && (
          <InvoiceTableToolbar
            invoiceCount={invoices.length}
            allFilteredSelected={allFilteredSelected}
            onToggleSelectAll={toggleSelectAllFiltered}
            onClearSelection={clearSelection}
            selectedCount={selectedRows.length}
            showBulkActions={showBulkToolbar}
            pendingInSelection={pendingInSelection}
            bulkWorking={bulkWorking}
            onBulkApprove={handleBulkApprove}
            unsentInSelection={unsentInSelection}
            sentInSelection={sentInSelection}
            onBulkMarkSentToAccountant={handleBulkMarkSentToAccountant}
            onBulkMarkNotSentToAccountant={handleBulkMarkNotSentToAccountant}
            buildExportRows={buildExportRows}
            downloadIds={downloadIds}
            downloadLabelCount={downloadLabelCount}
            downloadDisabled={
              downloadRequiresSelection
                ? selectedRows.length === 0
                : invoices.length === 0
            }
          />
        )}

        <div className="min-w-0 rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={
                        header.column.id === "accountantSent"
                          ? "h-10 w-6 max-w-6 min-w-6 p-0 px-0.5 text-center"
                          : header.column.id === "select"
                            ? "w-10 max-w-10 px-2 py-2 [&:has([role=checkbox])]:pe-0"
                            : undefined
                      }
                    >
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
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className="data-[state=selected]:bg-muted/50"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={
                          cell.column.id === "accountantSent"
                            ? "w-6 max-w-6 min-w-6 p-0 px-0.5 text-center align-middle"
                            : cell.column.id === "select"
                              ? "w-10 max-w-10 px-2 py-2 [&:has([role=checkbox])]:pe-0"
                              : undefined
                        }
                      >
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
                    colSpan={tableColumns.length}
                    className="h-24 text-center"
                  >
                    {t.noInvoicesFound}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {totalsByCurrency.length > 0 && (
              <TableFooter>
                {totalsByCurrency.map(([currency, totals]) => (
                  <TableRow
                    key={currency}
                    className="bg-muted/40 font-semibold hover:bg-muted/40"
                  >
                    <TableCell colSpan={amountColIdx}>
                      {totalsByCurrency.length > 1
                        ? t.totalCurrency.replace("{currency}", currency)
                        : t.total}
                    </TableCell>
                    <TableCell className="font-medium text-blue-600">
                      {formatCurrency(totals.amount, currency)}
                    </TableCell>
                    <TableCell className="font-medium text-blue-600">
                      {formatCurrency(totals.vat, currency)}
                    </TableCell>
                    {trailingColCount > 0 && (
                      <TableCell colSpan={trailingColCount} />
                    )}
                  </TableRow>
                ))}
              </TableFooter>
            )}
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t.invoicesTotal.replace(
              "{count}",
              table.getFilteredRowModel().rows.length.toString()
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              {t.previous}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t.pageOf
                .replace(
                  "{page}",
                  (table.getState().pagination.pageIndex + 1).toString()
                )
                .replace("{total}", table.getPageCount().toString())}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              {t.next}
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      </div>
    </InvoiceReextractProvider>
  );
}
