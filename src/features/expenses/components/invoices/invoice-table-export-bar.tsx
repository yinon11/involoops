"use client";

import { ExportCsvButton } from "@/components/shared/export-csv-button";
import { InvoiceDownloadButton } from "@/components/shared/invoice-download-button";
import { cn } from "@/lib/utils";

export interface InvoiceTableExportBarProps {
  buildExportRows: () => readonly object[];
  downloadIds: readonly string[] | (() => readonly string[]);
  /** Selected row count (shown on export buttons; 0 disables export). */
  selectedCount: number;
  /** Label for download button; undefined = plain "Download" (no count). */
  downloadLabelCount?: number;
  downloadDisabled: boolean;
  /** File base names without extension. */
  filename?: string;
  className?: string;
}

/**
 * CSV export + file download for invoice tables. Uses the same selected rows
 * for CSV; download semantics follow {@link InvoiceDownloadButton}.
 */
export function InvoiceTableExportBar({
  buildExportRows,
  downloadIds,
  selectedCount,
  downloadLabelCount,
  downloadDisabled,
  filename = "invoices",
  className,
}: InvoiceTableExportBarProps) {
  const exportDisabled = selectedCount === 0;

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      <ExportCsvButton
        rows={buildExportRows}
        filename={filename}
        disabled={exportDisabled}
        count={selectedCount}
      />
      <InvoiceDownloadButton
        ids={downloadIds}
        count={downloadLabelCount}
        disabled={downloadDisabled}
      />
    </div>
  );
}
