"use client";

import { useState, useEffect } from "react";
import { invoicePreviewRequestSrc } from "@/lib/file-preview";
import { InvoicePreviewFrame } from "@/features/expenses/components/invoices/invoice-preview-frame";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Save,
  Trash2,
  Lock,
  FileText,
  Loader2,
  Edit2,
} from "lucide-react";
import { updateInvoice, deleteInvoice, setInvoiceSentToAccountant } from "@/features/expenses/actions/invoice-actions";
import { VendorResolutionPanel } from "@/features/expenses/components/invoices/vendor-resolution-panel";
import { FixedAssetBanner } from "@/features/expenses/components/invoices/fixed-asset-banner";
import { useT } from "@/lib/i18n/client";

interface InvoiceDetail {
  id: string;
  vendorId: string | null;
  suggestedVendorName: string | null;
  vendorName: string | null;
  vendorCategory: string | null;
  type: string | null;
  status: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: string;
  currency: string | null;
  vatAmount: string | null;
  amountWithoutVat: string | null;
  description: string | null;
  expenseCategory: string | null;
  isFixedAsset: boolean;
  fixedAssetSynced: boolean;
  fileUrl: string | null;
  fileName: string | null;
  extractionMethod: string | null;
  extractionConfidence: string | null;
  rejectionReason: string | null;
  addedMonth: string | null;
  sentToAccountantAt: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface AuditEntry {
  id: string;
  action: string;
  details: unknown;
  createdAt: Date | null;
}

interface Props {
  invoice: InvoiceDetail;
  auditLog: AuditEntry[];
  vendors: { id: string; name: string; isIncomeSource: boolean }[];
  /** Period lock for the invoice **document date** (not upload month). */
  invoicePeriodLocked: boolean;
}

interface FormData {
  invoiceDate: string;
  amount: string;
  currency: string;
  vatAmount: string;
  invoiceNumber: string;
  type: string;
  description: string;
}

function statusVariant(status: string) {
  switch (status) {
    case "approved":
      return "default" as const;
    case "rejected":
      return "destructive" as const;
    case "pending":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function InvoiceDetailClient({
  invoice,
  auditLog,
  vendors,
  invoicePeriodLocked,
}: Props) {
  const router = useRouter();
  const dict = useT();
  const detailT = dict.invoices.detail;
  const tableT = dict.invoices.table;
  const statusT = dict.invoices.status;
  const typeT = dict.invoices.type;
  const auditT = dict.invoices.audit;
  const statusLabel = (value: string | null | undefined) =>
    (value && statusT[value as keyof typeof statusT]) || value || "";
  const typeLabel = (value: string | null | undefined) =>
    (value && typeT[value as keyof typeof typeT]) || value || null;
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState<"save" | "delete" | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showVendorOverride, setShowVendorOverride] = useState(false);
  const [sentToAccountant, setSentToAccountant] = useState(
    Boolean(invoice.sentToAccountantAt),
  );
  const [acctLoading, setAcctLoading] = useState(false);

  useEffect(() => {
    setSentToAccountant(Boolean(invoice.sentToAccountantAt));
  }, [invoice.sentToAccountantAt]);

  const previewSrc = invoice.fileUrl
    ? invoicePreviewRequestSrc(invoice.id)
    : null;

  const needsVendorResolution =
    invoice.status === "pending" &&
    !invoice.vendorId &&
    !!invoice.suggestedVendorName?.trim();

  const isPeriodLocked =
    invoice.status === "approved" && invoicePeriodLocked;

  // Allow overriding the auto-detected vendor for any invoice that already
  // has one linked, as long as the period isn't locked. This is the
  // counterpart to the resolution panel for unmatched invoices.
  const canOverrideVendor = !!invoice.vendorId && !isPeriodLocked;
  // We'll allow editing unless we get an error back from the server action

  const { register, handleSubmit, setValue, watch } = useForm<FormData>({
    defaultValues: {
      invoiceDate: invoice.invoiceDate ?? "",
      amount: invoice.amount ?? "0",
      currency: invoice.currency ?? "ILS",
      vatAmount: invoice.vatAmount ?? "",
      invoiceNumber: invoice.invoiceNumber ?? "",
      type: invoice.type ?? "expense",
      description: invoice.description ?? "",
    },
  });

  const currencyValue = watch("currency");
  const typeValue = watch("type");

  async function handleSave(data: FormData) {
    if (needsVendorResolution) {
      setFeedback({
        type: "error",
        message:
          "Link or add a vendor (Save vendor above) before saving the invoice.",
      });
      return;
    }
    setLoading("save");
    setFeedback(null);
    try {
      const result = await updateInvoice(invoice.id, {
        invoiceDate: data.invoiceDate,
        amount: data.amount,
        currency: data.currency,
        vatAmount: data.vatAmount || undefined,
        invoiceNumber: data.invoiceNumber,
        type: data.type as "expense" | "income",
        description: data.description,
      });
      // Re-throw client-side so the surrounding catch surfaces the
      // server's validation message; Next.js production redacts thrown
      // server-action errors but preserves returned values.
      if (!result.success) throw new Error(result.error);
      setFeedback({ type: "success", message: "Invoice updated successfully" });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete() {
    setLoading("delete");
    setFeedback(null);
    try {
      await deleteInvoice(invoice.id);
      router.push("/invoices");
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Delete failed",
      });
      setShowDeleteDialog(false);
    } finally {
      setLoading(null);
    }
  }

  async function handleSentToAccountantToggle(next: boolean) {
    setAcctLoading(true);
    setFeedback(null);
    const prev = sentToAccountant;
    setSentToAccountant(next);
    try {
      const result = await setInvoiceSentToAccountant(invoice.id, next);
      if (!result.success) {
        setSentToAccountant(prev);
        setFeedback({ type: "error", message: result.error });
        return;
      }
      router.refresh();
    } catch (err) {
      setSentToAccountant(prev);
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : tableT.accountantBulkFailed,
      });
    } finally {
      setAcctLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {invoice.isFixedAsset && !invoice.fixedAssetSynced && (
        <FixedAssetBanner
          invoiceId={invoice.id}
          expenseCategory={invoice.expenseCategory}
          amount={
            invoice.amountWithoutVat
              ? parseFloat(invoice.amountWithoutVat)
              : parseFloat(invoice.amount)
          }
          currency={invoice.currency ?? "ILS"}
        />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/invoices">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" />
            Back to list
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Invoice {invoice.invoiceNumber ?? invoice.id.slice(0, 8)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {invoice.vendorId ? (
              <Link
                href={`/vendors/${invoice.vendorId}`}
                className={
                  needsVendorResolution
                    ? "font-medium text-red-600 hover:underline"
                    : "font-medium text-primary hover:underline"
                }
              >
                {invoice.vendorName ??
                  invoice.suggestedVendorName ??
                  detailT.unknownVendor}
              </Link>
            ) : (
              <span
                className={
                  needsVendorResolution ? "font-medium text-red-600" : undefined
                }
              >
                {invoice.vendorName ??
                  invoice.suggestedVendorName ??
                  detailT.unknownVendor}
              </span>
            )}
            {needsVendorResolution && (
              <span className="ms-1 text-xs text-red-600">
                {detailT.notLinkedYet}
              </span>
            )}{" "}
            &middot; {invoice.invoiceDate ?? detailT.noDate}
          </p>
        </div>
        {invoice.status === "pending" ? (
          <Link
            href={`/pending?invoice=${invoice.id}`}
            className="inline-flex"
            title={tableT.openInPendingQueue}
          >
            <Badge
              variant={statusVariant("pending")}
              className="hover:underline"
            >
              {statusT.pending}
            </Badge>
          </Link>
        ) : (
          <Badge
            variant={statusVariant(invoice.status ?? "processing")}
          >
            {statusLabel(invoice.status)}
          </Badge>
        )}
        {isPeriodLocked && (
          <Badge variant="outline" className="gap-1">
            <Lock className="h-3 w-3" />
            {detailT.periodLockedBadge}
          </Badge>
        )}
      </div>

      {invoice.rejectionReason && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>{detailT.rejectionReason}</strong> {invoice.rejectionReason}
        </div>
      )}

      {needsVendorResolution && invoice.suggestedVendorName && (
        <VendorResolutionPanel
          invoiceId={invoice.id}
          suggestedVendorName={invoice.suggestedVendorName}
          vendors={vendors}
          onResolved={() => router.refresh()}
        />
      )}
      {/* Detail view has no inline Vendor form field, so nothing beyond
          refresh is needed here. The resolved name is picked up from the
          re-fetched server data. */}

      {canOverrideVendor && !needsVendorResolution && (
        <div className="space-y-2">
          {!showVendorOverride ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowVendorOverride(true)}
            >
              <Edit2 className="me-1 h-4 w-4" />
              Change vendor
            </Button>
          ) : (
            <>
              <VendorResolutionPanel
                invoiceId={invoice.id}
                currentVendor={{
                  id: invoice.vendorId!,
                  name: invoice.vendorName ?? "(unnamed)",
                }}
                vendors={vendors}
                onResolved={() => {
                  setShowVendorOverride(false);
                  router.refresh();
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowVendorOverride(false)}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: PDF Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              {detailT.documentPreview}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InvoicePreviewFrame
              previewSrc={previewSrc}
              className="h-[600px] w-full rounded-md border"
              title={detailT.previewTitle}
            />
          </CardContent>
        </Card>

        {/* Right: Details / Edit Form */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{detailT.detailsTitle}</CardTitle>
                {!editing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(true)}
                  >
                    <Edit2 className="me-1 h-4 w-4" />
                    {dict.common.edit}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {editing ? (
                <form
                  onSubmit={handleSubmit(handleSave)}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>{detailT.invoiceDate}</Label>
                      <Input type="date" {...register("invoiceDate")} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{detailT.invoiceNumber}</Label>
                      <Input {...register("invoiceNumber")} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label>{detailT.amount}</Label>
                      <Input
                        type="number"
                        step="0.01"
                        {...register("amount")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{detailT.currency}</Label>
                      <Select
                        value={currencyValue}
                        onValueChange={(v) => setValue("currency", v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ILS">ILS</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{detailT.vatAmount}</Label>
                      <Input
                        type="number"
                        step="0.01"
                        {...register("vatAmount")}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{detailT.type}</Label>
                    <Select
                      value={typeValue}
                      onValueChange={(v) => setValue("type", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expense">{typeT.expense}</SelectItem>
                        <SelectItem value="income">{typeT.income}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{detailT.description}</Label>
                    <Textarea rows={3} {...register("description")} />
                  </div>

                  {feedback && (
                    <div
                      className={`rounded-md p-2 text-sm ${
                        feedback.type === "success"
                          ? "bg-green-50 text-green-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {feedback.message}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={loading === "save" || needsVendorResolution}
                    >
                      {loading === "save" ? (
                        <Loader2 className="me-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="me-1 h-4 w-4" />
                      )}
                      {dict.common.save}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(false)}
                    >
                      {dict.common.cancel}
                    </Button>
                  </div>
                </form>
              ) : (
                <dl className="space-y-3">
                  <DetailRow
                    label={detailT.vendor}
                    value={
                      invoice.vendorName ?? invoice.suggestedVendorName ?? null
                    }
                  />
                  <DetailRow label={detailT.category} value={invoice.vendorCategory} />
                  <DetailRow label={detailT.date} value={invoice.invoiceDate} />
                  <DetailRow label={detailT.invoiceNumber} value={invoice.invoiceNumber} />
                  <DetailRow
                    label={detailT.amount}
                    value={
                      invoice.amount
                        ? `${invoice.currency} ${parseFloat(invoice.amount).toFixed(2)}`
                        : null
                    }
                  />
                  <DetailRow
                    label={dict.invoices.columns.vat}
                    value={
                      invoice.vatAmount
                        ? `${invoice.currency} ${parseFloat(invoice.vatAmount).toFixed(2)}`
                        : null
                    }
                  />
                  <DetailRow label={detailT.type} value={typeLabel(invoice.type)} />
                  <DetailRow label={detailT.description} value={invoice.description} />
                  <DetailRow
                    label={detailT.addedMonth}
                    value={invoice.addedMonth}
                  />
                  <div className="flex items-start justify-between gap-4 pt-1">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {detailT.sentToAccountant}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {detailT.sentToAccountantHint}
                      </p>
                    </div>
                    <Switch
                      checked={sentToAccountant}
                      disabled={acctLoading}
                      onCheckedChange={(v) =>
                        void handleSentToAccountantToggle(v)
                      }
                      aria-label={detailT.sentToAccountant}
                    />
                  </div>
                  <DetailRow
                    label={detailT.uploadedAt}
                    value={
                      invoice.createdAt
                        ? new Date(invoice.createdAt).toLocaleString()
                        : null
                    }
                  />
                  <DetailRow
                    label={detailT.extraction}
                    value={invoice.extractionMethod}
                  />
                  <DetailRow
                    label={detailT.confidence}
                    value={
                      invoice.extractionConfidence
                        ? `${(parseFloat(invoice.extractionConfidence) * 100).toFixed(0)}%`
                        : null
                    }
                  />
                  <DetailRow label={detailT.file} value={invoice.fileName} />

                  {feedback && (
                    <div
                      className={`rounded-md p-2 text-sm ${
                        feedback.type === "success"
                          ? "bg-green-50 text-green-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {feedback.message}
                    </div>
                  )}
                </dl>
              )}
            </CardContent>
          </Card>

          {/* Delete */}
          <Card>
            <CardContent className="pt-6">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="me-1 h-4 w-4" />
                {detailT.deleteInvoice}
              </Button>
            </CardContent>
          </Card>

          {/* Audit Log */}
          {auditLog.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{detailT.auditLog}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {auditLog.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-md border p-2 text-sm"
                    >
                      <div>
                        <span className="font-medium">
                          {auditT[entry.action as keyof typeof auditT] ??
                            entry.action}
                        </span>
                        {entry.details != null && (
                          <span className="ms-2 text-muted-foreground">
                            {JSON.stringify(entry.details) as string}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {entry.createdAt
                          ? new Date(entry.createdAt).toLocaleString()
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailT.deleteConfirmTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {detailT.deleteConfirmBody}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              {dict.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading === "delete"}
            >
              {loading === "delete" && (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              )}
              {dict.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value ?? "--"}</dd>
    </div>
  );
}
