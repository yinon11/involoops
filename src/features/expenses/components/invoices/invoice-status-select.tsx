"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import {
  approveInvoice,
  approveInvoiceAndCreateVendor,
  rejectInvoice,
  setInvoicePending,
} from "@/features/expenses/actions/invoice-actions";
import { useT } from "@/lib/i18n/client";

const STATUS_OPTIONS = ["pending", "approved", "rejected"] as const;

export function InvoiceStatusSelect({
  invoiceId,
  status: initialStatus,
  vendorId,
  suggestedVendorName,
}: {
  invoiceId: string;
  status: string;
  vendorId: string | null | undefined;
  suggestedVendorName: string | null | undefined;
}) {
  const router = useRouter();
  const dict = useT();
  const t = dict.invoices.statusSelect;
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [approveVendorOpen, setApproveVendorOpen] = useState(false);
  const [vendorNameDraft, setVendorNameDraft] = useState("");

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus, invoiceId]);

  if (initialStatus === "processing") {
    return (
      <Badge variant="outline" className="capitalize">
        Processing
      </Badge>
    );
  }

  async function applyChange(next: string) {
    if (next === status) return;
    if (next === "approved") {
      if (!vendorId && suggestedVendorName?.trim()) {
        setVendorNameDraft(suggestedVendorName.trim());
        setApproveVendorOpen(true);
        return;
      }
    }

    setBusy(true);
    try {
      if (next === "approved") {
        const result = await approveInvoice(invoiceId);
        // Re-throw client-side so the toast shows the server's
        // validation message; Next.js production redacts thrown
        // server-action errors but preserves returned values.
        if (!result.success) throw new Error(result.error);
        setStatus("approved");
        toast.success(dict.approval.card.approved);
        router.refresh();
        return;
      }
      if (next === "pending") {
        const result = await setInvoicePending(invoiceId);
        if (!result.success) throw new Error(result.error);
        setStatus("pending");
        toast.success(t.movedToPending);
        router.refresh();
        return;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.updateStatusFailed);
    } finally {
      setBusy(false);
    }
  }

  async function confirmApproveWithNewVendor() {
    const name = vendorNameDraft.trim();
    if (!name) {
      toast.error(t.enterVendorName);
      return;
    }
    setBusy(true);
    try {
      const result = await approveInvoiceAndCreateVendor(invoiceId, name);
      if (!result.success) throw new Error(result.error);
      setStatus("approved");
      setApproveVendorOpen(false);
      toast.success(t.vendorSavedAndApproved);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.approveFailed);
    } finally {
      setBusy(false);
    }
  }

  function handleSelectChange(value: string) {
    if (value === "__queue") {
      router.push(`/pending?invoice=${invoiceId}`);
      return;
    }
    if (value === "rejected") {
      setRejectOpen(true);
      return;
    }
    void applyChange(value);
  }

  async function confirmReject() {
    if (!rejectReason.trim()) return;
    setBusy(true);
    try {
      await rejectInvoice(invoiceId, rejectReason.trim());
      setStatus("rejected");
      setRejectOpen(false);
      setRejectReason("");
      toast.success(dict.approval.card.rejected);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.rejectFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Select
        value={status}
        onValueChange={handleSelectChange}
        disabled={busy}
      >
        <SelectTrigger className="h-8 w-[142px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {status === "pending" && (
            <>
              <SelectItem value="__queue" className="text-primary">
                {t.viewInPendingQueue}
              </SelectItem>
              <SelectSeparator />
            </>
          )}
          {STATUS_OPTIONS.map((value) => (
            <SelectItem key={value} value={value}>
              {dict.invoices.status[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog
        open={approveVendorOpen}
        onOpenChange={(open) => {
          setApproveVendorOpen(open);
          if (!open) setVendorNameDraft("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.vendorDialog.title}</DialogTitle>
            <DialogDescription>
              {t.vendorDialog.description}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="approve-vendor-name">{t.vendorDialog.vendorName}</Label>
            <Input
              id="approve-vendor-name"
              value={vendorNameDraft}
              onChange={(e) => setVendorNameDraft(e.target.value)}
              placeholder={t.vendorDialog.vendorName}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setApproveVendorOpen(false)}
            >
              {dict.common.cancel}
            </Button>
            <Button
              type="button"
              className="bg-green-600 hover:bg-green-700"
              disabled={!vendorNameDraft.trim() || busy}
              onClick={() => void confirmApproveWithNewVendor()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t.vendorDialog.confirm
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) setRejectReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.rejectDialog.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason-list">{t.rejectDialog.reason}</Label>
            <Textarea
              id="reject-reason-list"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder={t.rejectDialog.placeholder}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(false)}
            >
              {dict.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!rejectReason.trim() || busy}
              onClick={() => void confirmReject()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t.rejectDialog.confirm
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
