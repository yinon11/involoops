"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FileText, Loader2, Paperclip, Send } from "lucide-react";
import { toast } from "sonner";
import { reportInvoiceProblem } from "@/features/expenses/actions/invoice-actions";
import { InvoicePreviewFrame } from "@/features/expenses/components/invoices/invoice-preview-frame";
import { invoicePreviewRequestSrc } from "@/lib/file-preview";
import { useI18n } from "@/lib/i18n/client";
import { getRecentClientLogs } from "@/lib/client-logs";
import type { PendingInvoice } from "./review-card";

interface ProblemReportModalProps {
  invoice: PendingInvoice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProblemReportModal({
  invoice,
  open,
  onOpenChange,
}: ProblemReportModalProps) {
  const { dict } = useI18n();
  const t = dict.reviewCard.problemDialog;
  const fields = dict.reviewCard.fields;
  const [message, setMessage] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const previewSrc = invoice.fileUrl
    ? invoicePreviewRequestSrc(invoice.id)
    : null;

  function reset() {
    setMessage("");
    setAgreed(false);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSend() {
    if (!agreed || submitting) return;
    setSubmitting(true);
    try {
      const logs = getRecentClientLogs(100);
      const res = await reportInvoiceProblem(invoice.id, message, logs);
      if (!res.ok) {
        toast.error(res.error || t.sendFailed);
        return;
      }
      toast.success(t.toastSuccess);
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.sendFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Paperclip className="h-4 w-4" />
              <span>{t.attached}</span>
            </div>

            <div className="flex gap-3">
              <div className="h-32 w-24 flex-shrink-0 overflow-hidden rounded border bg-white">
                {previewSrc ? (
                  <InvoicePreviewFrame
                    previewSrc={previewSrc}
                    title={invoice.fileName ?? "invoice"}
                    className="h-full w-full border-0"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <FileText className="h-6 w-6" />
                  </div>
                )}
              </div>

              <dl className="grid flex-1 grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{fields.vendor}</dt>
                <dd>
                  {invoice.vendorName ??
                    invoice.suggestedVendorName ??
                    dict.reviewCard.unknownVendor}
                </dd>

                <dt className="text-muted-foreground">{fields.invoiceNumber}</dt>
                <dd>{invoice.invoiceNumber ?? "—"}</dd>

                <dt className="text-muted-foreground">{fields.invoiceDate}</dt>
                <dd>{invoice.invoiceDate ?? "—"}</dd>

                <dt className="text-muted-foreground">{fields.amount}</dt>
                <dd>
                  {invoice.amount} {invoice.currency ?? ""}
                </dd>

                <dt className="text-muted-foreground">{t.file}</dt>
                <dd className="truncate">{invoice.fileName ?? "—"}</dd>
              </dl>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id={`problem-agree-${invoice.id}`}
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
            />
            <Label
              htmlFor={`problem-agree-${invoice.id}`}
              className="text-sm font-normal leading-snug text-muted-foreground"
            >
              {t.disclaimer}
            </Label>
          </div>

          <Textarea
            placeholder={t.placeholder}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {t.cancel}
          </Button>
          <Button onClick={handleSend} disabled={!agreed || submitting}>
            {submitting ? (
              <Loader2 className="me-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="me-1 h-4 w-4" />
            )}
            {t.send}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
