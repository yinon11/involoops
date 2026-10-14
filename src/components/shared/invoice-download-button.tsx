"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useT } from "@/lib/i18n/client";

interface InvoiceDownloadButtonProps {
  /** Invoice IDs to include. Resolved at click time when a function is given. */
  ids: readonly string[] | (() => readonly string[]);
  /** Optional count shown in the label (e.g. "Download (5)"). */
  count?: number;
  disabled?: boolean;
  className?: string;
}

export function InvoiceDownloadButton({
  ids,
  count,
  disabled,
  className,
}: InvoiceDownloadButtonProps) {
  const dict = useT();
  const shared = dict.shared;
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    const list = typeof ids === "function" ? ids() : ids;
    if (list.length === 0) {
      toast.error(shared.nothingToDownload);
      return;
    }
    setIsPending(true);
    try {
      const res = await fetch("/api/invoices/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: list }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `${shared.downloadFailed} (${res.status})`);
      }

      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(cd);
      const fallback = list.length > 1 ? "invoices.zip" : "invoice";
      const filename = m?.[1] ?? fallback;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : shared.downloadFailed);
    } finally {
      setIsPending(false);
    }
  }

  const label =
    count != null ? `${shared.download} (${count})` : shared.download;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={disabled || isPending}
      className={className}
    >
      {isPending ? (
        <Loader2 className="me-1 h-4 w-4 animate-spin" />
      ) : (
        <FileDown className="me-1 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}
