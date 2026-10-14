"use client";

import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Loader2,
  Send,
  XCircle,
} from "lucide-react";
import { InvoiceTableExportBar } from "./invoice-table-export-bar";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export interface InvoiceTableToolbarProps {
  invoiceCount: number;
  allFilteredSelected: boolean;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  selectedCount: number;
  showBulkActions: boolean;
  pendingInSelection: number;
  bulkWorking: null | "approve" | "accountant-sent" | "accountant-unsent";
  onBulkApprove: () => void | Promise<void>;
  unsentInSelection: number;
  sentInSelection: number;
  onBulkMarkSentToAccountant: () => void | Promise<void>;
  onBulkMarkNotSentToAccountant: () => void | Promise<void>;
  buildExportRows: () => readonly object[];
  downloadIds: readonly string[] | (() => readonly string[]);
  /** Shown as "Download (n)"; omit when undefined (main list, no selection = all filtered). */
  downloadLabelCount?: number;
  downloadDisabled: boolean;
  exportFilename?: string;
  className?: string;
}

export function InvoiceTableToolbar({
  invoiceCount,
  allFilteredSelected,
  onToggleSelectAll,
  onClearSelection,
  selectedCount,
  showBulkActions,
  pendingInSelection,
  bulkWorking,
  onBulkApprove,
  unsentInSelection,
  sentInSelection,
  onBulkMarkSentToAccountant,
  onBulkMarkNotSentToAccountant,
  buildExportRows,
  downloadIds,
  downloadLabelCount,
  downloadDisabled,
  exportFilename,
  className,
}: InvoiceTableToolbarProps) {
  const t = useT().invoices.table;

  return (
    <div
      className={cn(
        "rounded-lg border bg-muted/30 p-3",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleSelectAll}
            aria-pressed={allFilteredSelected}
          >
            {allFilteredSelected
              ? t.deselectAllN.replace("{count}", invoiceCount.toString())
              : t.selectAllN.replace("{count}", invoiceCount.toString())}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            disabled={selectedCount === 0}
          >
            {t.clearSelection}
          </Button>
          {selectedCount > 0 && (
            <span className="text-sm text-muted-foreground">
              {t.rowsSelected.replace(
                "{count}",
                selectedCount.toString(),
              )}
            </span>
          )}
          {showBulkActions && (
            <>
              <span
                className="text-muted-foreground select-none px-0.5"
                aria-hidden
              >
                |
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  selectedCount === 0 ||
                  pendingInSelection === 0 ||
                  bulkWorking !== null
                }
                onClick={() => void onBulkApprove()}
              >
                {bulkWorking === "approve" ? (
                  <Loader2 className="me-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="me-1 h-4 w-4" />
                )}
                {t.approvePending.replace(
                  "{count}",
                  pendingInSelection.toString(),
                )}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  selectedCount === 0 ||
                  unsentInSelection === 0 ||
                  bulkWorking !== null
                }
                onClick={() => void onBulkMarkSentToAccountant()}
              >
                {bulkWorking === "accountant-sent" ? (
                  <Loader2 className="me-1 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="me-1 h-4 w-4" />
                )}
                {t.markSentToAccountant.replace(
                  "{count}",
                  unsentInSelection.toString(),
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  selectedCount === 0 ||
                  sentInSelection === 0 ||
                  bulkWorking !== null
                }
                onClick={() => void onBulkMarkNotSentToAccountant()}
              >
                {bulkWorking === "accountant-unsent" ? (
                  <Loader2 className="me-1 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="me-1 h-4 w-4" />
                )}
                {t.markNotSentToAccountant.replace(
                  "{count}",
                  sentInSelection.toString(),
                )}
              </Button>
            </>
          )}
        </div>
        <InvoiceTableExportBar
          buildExportRows={buildExportRows}
          downloadIds={downloadIds}
          selectedCount={selectedCount}
          downloadLabelCount={downloadLabelCount}
          downloadDisabled={downloadDisabled}
          filename={exportFilename}
          className="sm:shrink-0"
        />
      </div>
    </div>
  );
}
