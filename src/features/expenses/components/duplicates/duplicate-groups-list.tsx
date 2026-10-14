"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCheck,
  ExternalLink,
  Hash,
  Loader2,
  Trash2,
  UserCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InvoicePreviewFrame } from "@/features/expenses/components/invoices/invoice-preview-frame";
import { invoicePreviewRequestSrc } from "@/lib/file-preview";
import { formatCurrency } from "@/lib/currency";
import { deleteInvoice } from "@/features/expenses/actions/invoice-actions";
import { dismissDuplicateGroup } from "@/features/expenses/actions/duplicate-actions";
import type {
  DuplicateGroup,
  DuplicateInvoice,
} from "@/features/expenses/actions/duplicate-actions";
import { useI18n, useLocaleTag } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries";

function statusVariant(status: string | null) {
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

function statusLabel(
  status: string | null,
  t: Dictionary["duplicates"]["status"],
): string {
  switch (status) {
    case "approved":
      return t.approved;
    case "pending":
      return t.pending;
    case "rejected":
      return t.rejected;
    case "processing":
      return t.processing;
    default:
      return t.unknown;
  }
}

function formatAmount(amount: string, currency: string | null): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return formatCurrency(n, currency ?? "ILS");
}

function pendingCount(invoicesInGroup: DuplicateInvoice[]): number {
  return invoicesInGroup.filter((i) => i.status === "pending").length;
}

function formatDateTime(value: Date | string | null, locale: string): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(locale);
}

export function DuplicateGroupsList({ groups }: { groups: DuplicateGroup[] }) {
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <DuplicateGroupCard key={group.key} group={group} />
      ))}
    </div>
  );
}

function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.duplicates;
  const localeTag = useLocaleTag();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);

  const invoicesInGroup = group.invoices;
  const hasExtras = invoicesInGroup.length > 2;
  const numPending = pendingCount(invoicesInGroup);
  const dismissLabel =
    invoicesInGroup.length === 2
      ? t.group.notDuplicatesPair
      : t.group.notDuplicatesAll;

  // Which invoice shows in each pane (left / right). Defaults to the two most
  // recent; users can swap either side through the dropdowns.
  const [leftId, setLeftId] = useState<string>(invoicesInGroup[0]?.id ?? "");
  const [rightId, setRightId] = useState<string>(invoicesInGroup[1]?.id ?? "");

  const leftInvoice = useMemo(
    () => invoicesInGroup.find((i) => i.id === leftId) ?? invoicesInGroup[0],
    [invoicesInGroup, leftId]
  );
  const rightInvoice = useMemo(
    () => invoicesInGroup.find((i) => i.id === rightId) ?? invoicesInGroup[1],
    [invoicesInGroup, rightId]
  );

  function handleDismiss() {
    const ids = invoicesInGroup.map((i) => i.id);
    const approveNote =
      numPending > 0
        ? t.group.confirmDismissApproveNote.replace(
            "{count}",
            String(numPending),
          )
        : "";
    const description = t.group.confirmDismissDescription.replace(
      "{approveNote}",
      approveNote,
    );
    const title =
      invoicesInGroup.length === 2
        ? t.group.confirmDismissPair
        : t.group.confirmDismissMany.replace(
            "{count}",
            String(invoicesInGroup.length),
          );
    toast(title, {
      description,
      action: {
        label: t.group.confirmAction,
        onClick: () => {
          setIsDismissing(true);
          void (async () => {
            try {
              const res = await dismissDuplicateGroup(ids);
              if (!res.success) {
                toast.error(res.error);
                setIsDismissing(false);
                return;
              }
              if (res.approved > 0) {
                toast.success(
                  res.approved === 1
                    ? t.group.dismissedOneApproved
                    : t.group.dismissedManyApproved.replace(
                        "{count}",
                        String(res.approved),
                      ),
                );
              } else {
                toast.success(t.group.dismissedNoApprove);
              }
              if (res.skipped > 0) {
                toast.warning(
                  t.group.dismissedSkipped.replace(
                    "{count}",
                    String(res.skipped),
                  ),
                );
              }
              router.refresh();
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : t.group.dismissFailed,
              );
              setIsDismissing(false);
            }
          })();
        },
      },
      cancel: {
        label: t.group.cancel,
        onClick: () => {},
      },
    });
  }

  function handleDelete(invoice: DuplicateInvoice) {
    const label =
      invoice.invoiceNumber ?? invoice.fileName ?? invoice.id.slice(0, 8);
    toast(t.pane.confirmDeleteTitle, {
      description: t.pane.confirmDeleteDescription.replace("{label}", label),
      action: {
        label: t.pane.delete,
        onClick: () => {
          setPendingDeleteId(invoice.id);
          void (async () => {
            try {
              await deleteInvoice(invoice.id);
              toast.success(t.pane.deleted);
              router.refresh();
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : t.pane.deleteFailed,
              );
            } finally {
              setPendingDeleteId(null);
            }
          })();
        },
      },
      cancel: {
        label: t.group.cancel,
        onClick: () => {},
      },
    });
  }

  return (
    <Card className="overflow-hidden border-rose-200/70">
      <CardHeader className="gap-2 bg-rose-50/60 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          <span className="text-base font-semibold">{group.vendorLabel}</span>
          {!group.linkedVendor && group.matchReason === "vendor_amount_date" && (
            <Badge variant="outline" className="gap-1 text-xs">
              <UserCircle2 className="h-3 w-3" />
              {t.group.suggestedName}
            </Badge>
          )}
          {group.matchReason === "invoice_number" && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Hash className="h-3 w-3" />
              {t.group.sameInvoiceNumber}
            </Badge>
          )}
          <Badge variant="secondary" className="ms-auto">
            {t.group.matches.replace(
              "{count}",
              String(invoicesInGroup.length),
            )}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {group.matchReason === "vendor_amount_date" ? (
              <>
                <span>
                  <span className="font-medium text-foreground">
                    {group.amount
                      ? formatAmount(group.amount, group.currency)
                      : "—"}
                  </span>
                </span>
                <span>
                  {t.group.dateLabel}{" "}
                  <span className="font-medium text-foreground">
                    {group.invoiceDate || "—"}
                  </span>
                </span>
              </>
            ) : (
              <span>
                {t.group.invoiceNumberLabel}{" "}
                <span className="font-medium text-foreground">
                  {group.sharedInvoiceNumber ?? "—"}
                </span>
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-emerald-600/50 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
            onClick={handleDismiss}
            disabled={isDismissing}
            title={
              numPending > 0
                ? t.group.dismissTooltipPending
                : t.group.dismissTooltipNoPending
            }
          >
            {isDismissing ? (
              <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="me-1 h-3.5 w-3.5" />
            )}
            {dismissLabel}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {hasExtras && (
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InvoicePicker
              label={t.picker.first}
              value={leftInvoice?.id ?? ""}
              onChange={setLeftId}
              invoices={invoicesInGroup}
              disabledId={rightInvoice?.id}
            />
            <InvoicePicker
              label={t.picker.second}
              value={rightInvoice?.id ?? ""}
              onChange={setRightId}
              invoices={invoicesInGroup}
              disabledId={leftInvoice?.id}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {leftInvoice && (
            <InvoicePane
              invoice={leftInvoice}
              onDelete={handleDelete}
              isDeleting={pendingDeleteId === leftInvoice.id}
              localeTag={localeTag}
            />
          )}
          {rightInvoice && (
            <InvoicePane
              invoice={rightInvoice}
              onDelete={handleDelete}
              isDeleting={pendingDeleteId === rightInvoice.id}
              localeTag={localeTag}
            />
          )}
        </div>

        {hasExtras && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t.group.extrasNote.replace(
              "{count}",
              String(invoicesInGroup.length - 2),
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function InvoicePicker({
  label,
  value,
  onChange,
  invoices,
  disabledId,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  invoices: DuplicateInvoice[];
  disabledId: string | undefined;
}) {
  const { dict } = useI18n();
  const t = dict.duplicates;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={t.picker.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {invoices.map((inv) => (
            <SelectItem
              key={inv.id}
              value={inv.id}
              disabled={inv.id === disabledId}
            >
              {inv.invoiceNumber?.trim() ||
                inv.fileName?.trim() ||
                `#${inv.id.slice(0, 8)}`}
              {inv.status ? ` · ${statusLabel(inv.status, t.status)}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function InvoicePane({
  invoice,
  onDelete,
  isDeleting,
  localeTag,
}: {
  invoice: DuplicateInvoice;
  onDelete: (invoice: DuplicateInvoice) => void;
  isDeleting: boolean;
  localeTag: string;
}) {
  const { dict } = useI18n();
  const t = dict.duplicates;
  const previewSrc = invoice.fileUrl
    ? invoicePreviewRequestSrc(invoice.id)
    : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-md border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <Link
              href={`/invoices/${invoice.id}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
              title={t.pane.openTitle}
            >
              {invoice.invoiceNumber?.trim() ||
                `#${invoice.id.slice(0, 8)}`}
            </Link>
            <Badge variant={statusVariant(invoice.status)}>
              {statusLabel(invoice.status, t.status)}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {t.pane.uploadedAt.replace(
              "{date}",
              formatDateTime(invoice.createdAt, localeTag),
            )}
            {invoice.fileName ? ` · ${invoice.fileName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/invoices/${invoice.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              title={t.pane.openInNewTabTitle}
            >
              <ExternalLink className="me-1 h-3.5 w-3.5" />
              {t.pane.open}
            </Button>
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDelete(invoice)}
            disabled={isDeleting}
            title={t.pane.deleteTitle}
          >
            {isDeleting ? (
              <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="me-1 h-3.5 w-3.5" />
            )}
            {t.pane.delete}
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b px-3 py-2 text-xs">
        <dt className="text-muted-foreground">{t.pane.invoiceDate}</dt>
        <dd>{invoice.invoiceDate ?? "—"}</dd>
        <dt className="text-muted-foreground">{t.pane.amount}</dt>
        <dd>{formatAmount(invoice.amount, invoice.currency)}</dd>
        {invoice.vatAmount && (
          <>
            <dt className="text-muted-foreground">{t.pane.vat}</dt>
            <dd>{formatAmount(invoice.vatAmount, invoice.currency)}</dd>
          </>
        )}
        {invoice.description?.trim() && (
          <>
            <dt className="text-muted-foreground">{t.pane.description}</dt>
            <dd className="truncate" title={invoice.description}>
              {invoice.description}
            </dd>
          </>
        )}
      </dl>

      <div className="relative h-[420px] bg-muted">
        <InvoicePreviewFrame
          previewSrc={previewSrc}
          title={t.pane.iframeTitle.replace(
            "{label}",
            invoice.invoiceNumber ?? invoice.id,
          )}
          className="h-full w-full border-0"
        />
      </div>
    </div>
  );
}
