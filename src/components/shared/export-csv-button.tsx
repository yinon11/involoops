"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { downloadRowsAsCsv } from "@/lib/export-csv";
import { useT } from "@/lib/i18n/client";

interface ExportCsvButtonProps {
  rows: readonly object[] | (() => readonly object[]);
  filename: string;
  label?: string;
  count?: number;
  disabled?: boolean;
  className?: string;
}

export function ExportCsvButton({
  rows,
  filename,
  label,
  count,
  disabled,
  className,
}: ExportCsvButtonProps) {
  const t = useT().shared;
  const [isExporting, setIsExporting] = useState(false);
  const baseLabel = label ?? t.exportToCsv;
  const resolvedLabel =
    count != null ? `${baseLabel} (${count})` : baseLabel;

  function handleClick() {
    const data = typeof rows === "function" ? rows() : rows;
    if (data.length === 0) {
      toast.error(t.nothingToExport);
      return;
    }
    setIsExporting(true);
    try {
      downloadRowsAsCsv(data, filename);
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
        <FileSpreadsheet className="me-1 h-4 w-4" />
      )}
      {resolvedLabel}
    </Button>
  );
}
