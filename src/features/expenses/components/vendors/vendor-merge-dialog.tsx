"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Merge } from "lucide-react";
import { mergeVendors } from "@/features/expenses/actions/vendor-actions";

export interface VendorMergeCandidate {
  id: string;
  name: string;
  invoiceCount: number;
}

interface VendorMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: VendorMergeCandidate[];
  onMerged?: () => void;
}

export function VendorMergeDialog({
  open,
  onOpenChange,
  candidates,
  onMerged,
}: VendorMergeDialogProps) {
  const router = useRouter();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to the candidate with the most invoices when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (candidates.length === 0) {
      setTargetId(null);
      return;
    }
    const best = [...candidates].sort(
      (a, b) => b.invoiceCount - a.invoiceCount
    )[0];
    setTargetId(best.id);
  }, [open, candidates]);

  async function handleMerge() {
    if (!targetId) {
      setError("Pick the vendor to keep");
      return;
    }
    const sourceVendorIds = candidates
      .map((c) => c.id)
      .filter((id) => id !== targetId);
    if (sourceVendorIds.length === 0) {
      setError("Select at least two vendors to merge");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await mergeVendors({
        targetVendorId: targetId,
        sourceVendorIds,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onMerged?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-4 w-4" />
            Merge Vendors
          </DialogTitle>
          <DialogDescription>
            Pick the vendor to keep. The other names become its aliases, all
            invoices are moved to the kept vendor, and the others are deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {candidates.map((c) => {
            const id = `merge-target-${c.id}`;
            return (
              <Label
                key={c.id}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/50"
              >
                <input
                  id={id}
                  type="radio"
                  name="merge-target"
                  className="h-4 w-4"
                  checked={targetId === c.id}
                  onChange={() => setTargetId(c.id)}
                />
                <div className="flex-1">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.invoiceCount} invoice(s)
                  </div>
                </div>
                {targetId === c.id && (
                  <span className="text-xs font-semibold uppercase text-green-700">
                    Keep
                  </span>
                )}
              </Label>
            );
          })}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={loading || !targetId}>
            {loading ? (
              <Loader2 className="me-1 h-4 w-4 animate-spin" />
            ) : (
              <Merge className="me-1 h-4 w-4" />
            )}
            Merge {candidates.length} vendors
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
