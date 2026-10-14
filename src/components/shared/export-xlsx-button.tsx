"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { downloadRowsAsXlsx } from "@/lib/export-xlsx";
import { useT } from "@/lib/i18n/client";

interface ExportXlsxButtonProps {
  /** Rows to export. If a function is provided, it's invoked at click time. */
  rows: readonly object[] | (() => readonly object[]);
  /** Filename without extension. */
  filename: string;
  sheetName?: string;
  label?: string;
  /** Shown as "Label (count)" when provided, including 0 (same pattern as download). */
  count?: number;
  disabled?: boolean;
  className?: string;
}

export function ExportXlsxButton({
  rows,
  filename,
  sheetName,
  label,
  count,
  disabled,
  className,
}: ExportXlsxButtonProps) {
  const t = useT().shared;
  const [isExporting, setIsExporting] = useState(false);
  const baseLabel = label ?? t.exportToExcel;
  const resolvedLabel =
    count != null ? `${baseLabel} (${count})` : baseLabel;

  async function handleClick() {
    const data = typeof rows === "function" ? rows() : rows;
    if (data.length === 0) {
      toast.error(t.nothingToExport);
      return;
    }
    setIsExporting(true);
    try {
      await downloadRowsAsXlsx(data, { filename, sheetName });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.exportFailed);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={disabled || isExporting}
      className={className}
    >
      {isExporting ? (
        <Loader2 className="me-1 h-4 w-4 animate-spin" />
      ) : (
        <Download className="me-1 h-4 w-4" />
      )}
      {resolvedLabel}
    </Button>
  );
}
