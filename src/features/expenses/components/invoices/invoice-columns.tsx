"use client";

import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Copy, ExternalLink, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Badge } from "@/components/ui/badge";
import { invoicePreviewRequestSrc } from "@/lib/file-preview";
import { ReExtractInvoiceButton } from "./re-extract-invoice-button";
import { DeleteInvoiceButton } from "./delete-invoice-button";
import { InvoiceStatusSelect } from "./invoice-status-select";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useLocaleTag } from "@/lib/i18n/client";

function DateCell({ value }: { value: string }) {
  const tag = useLocaleTag();
  return (
    <span className="text-sm">
      {new Date(value).toLocaleDateString(tag, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}
    </span>
  );
}

export interface InvoiceRow {
  id: string;
  invoiceDate: string;
  vendorName: string;
  amount: number;
  vatAmount: number | null;
  currency: string;
  invoiceNumber: string | null;
  fileUrl: string | null;
  addedMonth: string;
  status: string;
  /** ISO timestamp when marked sent to accountant; absent = not sent. */
  sentToAccountantAt?: string | null;
  /** For approve from list — optional on dashboards that omit it. */
  vendorId?: string | null;
  suggestedVendorName?: string | null;
  /** Auto-detected capital purchase awaiting user confirmation. */
  isFixedAsset?: boolean;
  fixedAssetSynced?: boolean;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    // fallback silently
  });
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

export function createInvoiceColumns(options?: {
  showDelete?: boolean;
  /** Invoices list: inline status (approve / reject / pending). */
  showStatusActions?: boolean;
  /** Optional dictionary for header / cell text. Falls back to English literals
   * for callers that haven't been migrated yet. */
  dict?: Dictionary;
}): ColumnDef<InvoiceRow>[] {
  const t = options?.dict?.invoices.table;
  const tx = (key: keyof NonNullable<typeof t>, fallback: string): string =>
    (t?.[key] as string | undefined) ?? fallback;
  const cols: ColumnDef<InvoiceRow>[] = [
  {
    accessorKey: "invoiceDate",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ms-3 h-8"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {tx("colDate", "Date")}
        <ArrowUpDown className="ms-1 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const date = row.getValue("invoiceDate") as string;
      if (!date) return <span className="text-muted-foreground">--</span>;
      return <DateCell value={date} />;
    },
  },
  {
    accessorKey: "vendorName",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ms-3 h-8"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {tx("colVendor", "Vendor")}
        <ArrowUpDown className="ms-1 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const name = row.getValue("vendorName") as string;
      const vid = row.original.vendorId;
      const showFixedAssetBadge =
        row.original.isFixedAsset === true &&
        row.original.fixedAssetSynced !== true;
      const nameNode = vid ? (
        <Link
          href={`/vendors/${vid}`}
          className="font-medium text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {name}
        </Link>
      ) : (
        <span className="font-medium">{name}</span>
      );
      if (!showFixedAssetBadge) return nameNode;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {nameNode}
          <Link
            href={`/invoices/${row.original.id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex"
          >
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-[10px] font-semibold text-amber-800 hover:bg-amber-100"
            >
              {tx("fixedAssetBadge", "Fixed asset?")}
            </Badge>
          </Link>
        </div>
      );
    },
  },
  {
    accessorKey: "amount",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ms-3 h-8"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {tx("colAmount", "Amount")}
        <ArrowUpDown className="ms-1 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const amount = row.getValue("amount") as number;
      const currency = row.original.currency;
      return <CurrencyDisplay amount={amount} currency={currency} />;
    },
  },
  {
    accessorKey: "vatAmount",
    header: tx("colVat", "VAT"),
    cell: ({ row }) => {
      const vat = row.getValue("vatAmount") as number | null;
      const currency = row.original.currency;
      if (vat == null) return <span className="text-muted-foreground">--</span>;
      return <CurrencyDisplay amount={vat} currency={currency} />;
    },
  },
  {
    accessorKey: "currency",
    header: tx("colCurrency", "Currency"),
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs">
        {row.getValue("currency")}
      </Badge>
    ),
  },
  {
    accessorKey: "invoiceNumber",
    header: tx("colInvoice", "Invoice"),
    cell: ({ row }) => {
      const number = row.getValue("invoiceNumber") as string | null;
      const fileUrl = row.original.fileUrl;
      const previewHref =
        fileUrl && row.original.id
          ? invoicePreviewRequestSrc(row.original.id)
          : null;
      if (!number) return <span className="text-muted-foreground">--</span>;
      return (
        <div className="flex items-center gap-1.5">
          {previewHref ? (
            <a
              href={previewHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
            >
              {number}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-sm">{number}</span>
          )}
          <button
            onClick={() => copyToClipboard(number)}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={tx("copyInvoiceNumber", "Copy invoice number")}
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      );
    },
  },
  {
    accessorKey: "addedMonth",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ms-3 h-8"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {tx("colUploaded", "Uploaded")}
        <ArrowUpDown className="ms-1 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.getValue("addedMonth")}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: tx("colStatus", "Status"),
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      if (options?.showStatusActions) {
        return (
          <InvoiceStatusSelect
            invoiceId={row.original.id}
            status={status}
            vendorId={row.original.vendorId ?? null}
            suggestedVendorName={row.original.suggestedVendorName ?? null}
          />
        );
      }
      if (status === "pending") {
        return (
          <Link
            href={`/pending?invoice=${row.original.id}`}
            className="inline-flex"
            title={tx("openInPendingQueue", "Open in pending queue")}
          >
            <Badge
              variant={statusVariant(status)}
              className="capitalize hover:underline"
            >
              {status}
            </Badge>
          </Link>
        );
      }
      return (
        <Badge variant={statusVariant(status)} className="capitalize">
          {status}
        </Badge>
      );
    },
  },
  {
    id: "reextract",
    header: tx("colReRun", "Re-run"),
    cell: ({ row }) => (
      <ReExtractInvoiceButton
        invoiceId={row.original.id}
        hasFile={!!row.original.fileUrl?.trim()}
      />
    ),
    enableSorting: false,
  },
  {
    id: "watch",
    header: tx("colWatch", "Watch"),
    cell: ({ row }) => (
      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
        <a
          href={`/invoices/${row.original.id}`}
          target="_blank"
          rel="noopener noreferrer"
          title={tx("openInvoiceTitle", "Open invoice in a new tab")}
        >
          <Eye className="h-4 w-4" />
          <span className="sr-only">{tx("openInvoice", "Open invoice")}</span>
        </a>
      </Button>
    ),
    enableSorting: false,
  },
  ];

  if (options?.showDelete) {
    cols.push({
      id: "delete",
      header: "",
      cell: ({ row }) => (
        <DeleteInvoiceButton
          invoiceId={row.original.id}
          label={
            row.original.invoiceNumber?.trim() ||
            row.original.vendorName ||
            "this invoice"
          }
        />
      ),
      enableSorting: false,
    });
  }

  return cols;
}

/** Default columns (no delete). */
export const columns = createInvoiceColumns();
