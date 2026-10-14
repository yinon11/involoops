"use client";

/**
 * "Import from expenses" dialog for the tax-estimates fixed-assets form.
 *
 * Lists all invoices the extractor flagged as fixed assets but the user
 * has not yet synced. The user picks which to import and confirms;
 * each selected row is appended to tax_estimate_inputs.fixed_assets
 * via syncFixedAssetsBulk and the parent page revalidates.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getPendingFixedAssets,
  syncFixedAssetsBulk,
  type PendingFixedAssetRow,
} from "@/actions/fixed-asset-actions";

export interface ImportFromExpensesLabels {
  triggerLabel: string;
  title: string;
  description: string;
  loading: string;
  empty: string;
  cancel: string;
  /** Confirm button. Use {count} as a placeholder for the selected count. */
  confirm: string;
}

interface Props {
  labels: ImportFromExpensesLabels;
}

export function ImportFromExpensesDialog({ labels }: Props) {
  const router = useRouter();
  const t = labels;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PendingFixedAssetRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setLoading(true);
    getPendingFixedAssets()
      .then((data) => {
        setRows(data);
        // Pre-check all by default — most users want everything imported.
        setSelected(new Set(data.map((r) => r.invoiceId)));
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleImport() {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        await syncFixedAssetsBulk(ids);
        setOpen(false);
        router.refresh();
      } catch (e) {
        console.error(e);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 border-amber-200 text-xs text-amber-700 hover:bg-amber-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {labels.triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-slate-500">
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
            {t.loading}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">{t.empty}</p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {rows.map((row) => (
              <label
                key={row.invoiceId}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100"
              >
                <Checkbox
                  checked={selected.has(row.invoiceId)}
                  onCheckedChange={() => toggle(row.invoiceId)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {row.description}
                  </p>
                  <p className="text-xs text-slate-500">
                    {row.amount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    {row.currency} · {row.purchaseYear}
                  </p>
                </div>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {t.cancel}
          </Button>
          <Button
            size="sm"
            onClick={handleImport}
            disabled={isPending || rows.length === 0 || selected.size === 0}
            className="bg-violet-600 text-white hover:bg-violet-700"
          >
            {isPending && <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />}
            {t.confirm.replace("{count}", String(selected.size))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
