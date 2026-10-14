"use client";

import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Clock,
  FileSignature,
  MailCheck,
  CreditCard,
  XCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import type { ReactNode } from "react";
import type { OutboundInvoiceStatus } from "@/db/schema/outbound-invoices";

export type ShaamStatus =
  | "NOT_APPLICABLE"
  | "NOT_REQUIRED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "HELD"
  | "OUTAGE_ISSUED"
  | "ISSUED_WITHOUT_ALLOCATION"
  | "CANCELLED_AFTER_REJECTION"
  | "UNRESOLVED"
  | null
  | undefined;

interface ChipDictionary {
  outbound: {
    status: Record<OutboundInvoiceStatus, string>;
    paymentState?: { partial: string };
  };
  shaamSubmission: {
    status: Record<string, string>;
    combined: {
      issuedApproved: string;
      issuedPending: string;
      issuedRejected: string;
      issuedHeld: string;
      issuedOutage: string;
      issuedWithoutAllocation: string;
      cancelledAfterRejection: string;
      issuedUnresolved: string;
    };
  };
}

interface Props {
  status: OutboundInvoiceStatus;
  shaamStatus?: ShaamStatus;
  dict: ChipDictionary;
  /** When true, render the local status alongside the combined chip. */
  size?: "sm" | "md";
  /**
   * When the row is `issued`/`sent` and at least one linked receipt
   * has been issued but the running balance hasn't cleared, render a
   * "Partial" chip instead of the plain issued / sent variant. Driven
   * by `paymentState === "partial"` on the list rows.
   */
  partial?: boolean;
  /** External historical import — not issued here. */
  importedFromExternal?: boolean;
}

interface ChipVariant {
  label: string;
  icon: ReactNode;
  className: string;
  strikethrough?: boolean;
}

function resolveVariant(
  status: OutboundInvoiceStatus,
  shaamStatus: ShaamStatus,
  dict: ChipDictionary,
  partial: boolean,
  importedFromExternal: boolean,
): ChipVariant {
  if (importedFromExternal) {
    return {
      label: "Imported",
      icon: <Info className="h-3 w-3" />,
      className: "bg-slate-100 text-slate-700 border-slate-300",
    };
  }
  // Partial-payment override — only meaningful for rows the receipt
  // flow can settle (issued/sent tax invoices). Wins over the SHAAM
  // sub-state on the chip because for the seller, "partly paid" is
  // the more actionable signal than "ITA approved" on this surface.
  if (partial && (status === "issued" || status === "sent")) {
    return {
      label: dict.outbound.paymentState?.partial ?? "Partial",
      icon: <CreditCard className="h-3 w-3" />,
      className: "bg-amber-100 text-amber-800 border-amber-300",
    };
  }
  if (status === "draft") {
    return {
      label: dict.outbound.status.draft,
      icon: <FileSignature className="h-3 w-3" />,
      className: "bg-gray-100 text-gray-700 border-gray-300",
    };
  }
  if (status === "voided") {
    return {
      label:
        shaamStatus === "CANCELLED_AFTER_REJECTION"
          ? dict.shaamSubmission.combined.cancelledAfterRejection
          : dict.outbound.status.voided,
      icon: <XCircle className="h-3 w-3" />,
      className: "bg-gray-100 text-gray-600 border-gray-300 line-through",
      strikethrough: true,
    };
  }

  if (status === "issued") {
    switch (shaamStatus) {
      case "APPROVED":
        return {
          label: dict.shaamSubmission.combined.issuedApproved,
          icon: <CheckCircle2 className="h-3 w-3" />,
          className: "bg-green-100 text-green-800 border-green-300",
        };
      case "PENDING":
        return {
          label: dict.shaamSubmission.combined.issuedPending,
          icon: <Clock className="h-3 w-3" />,
          className: "bg-amber-100 text-amber-800 border-amber-300",
        };
      case "OUTAGE_ISSUED":
        return {
          label: dict.shaamSubmission.combined.issuedOutage,
          icon: <Clock className="h-3 w-3" />,
          className: "bg-amber-100 text-amber-800 border-amber-300",
        };
      case "REJECTED":
        return {
          label: dict.shaamSubmission.combined.issuedRejected,
          icon: <XCircle className="h-3 w-3" />,
          className: "bg-red-100 text-red-800 border-red-300",
        };
      case "HELD":
        return {
          label: dict.shaamSubmission.combined.issuedHeld,
          icon: <AlertTriangle className="h-3 w-3" />,
          className: "bg-orange-100 text-orange-800 border-orange-300",
        };
      // Not red: the seller chose this knowingly and the document is
      // valid. Amber marks the consequence (no VAT deduction for the
      // buyer), not a failure on our side.
      // Amber, not red: nothing was refused, we just stopped asking.
      case "UNRESOLVED":
        return {
          label: dict.shaamSubmission.combined.issuedUnresolved,
          icon: <AlertTriangle className="h-3 w-3" />,
          className: "bg-amber-100 text-amber-800 border-amber-300",
        };
      case "ISSUED_WITHOUT_ALLOCATION":
        return {
          label: dict.shaamSubmission.combined.issuedWithoutAllocation,
          icon: <AlertTriangle className="h-3 w-3" />,
          className: "bg-amber-100 text-amber-800 border-amber-300",
        };
      case "NOT_REQUIRED":
      case "NOT_APPLICABLE":
      case null:
      case undefined:
      default:
        return {
          label: dict.outbound.status.issued,
          icon: <FileSignature className="h-3 w-3" />,
          className: "bg-blue-100 text-blue-700 border-blue-300",
        };
    }
  }

  if (status === "sent") {
    return {
      label: dict.outbound.status.sent,
      icon: <MailCheck className="h-3 w-3" />,
      className: "bg-blue-100 text-blue-700 border-blue-300",
    };
  }
  if (status === "paid") {
    return {
      label: dict.outbound.status.paid,
      icon: <CreditCard className="h-3 w-3" />,
      className: "bg-green-100 text-green-800 border-green-300",
    };
  }

  return {
    label: dict.outbound.status[status] ?? String(status),
    icon: <Info className="h-3 w-3" />,
    className: "bg-gray-100 text-gray-700 border-gray-300",
  };
}

export function DocumentStatusChip({
  status,
  shaamStatus,
  dict,
  size = "md",
  partial = false,
  importedFromExternal = false,
}: Props) {
  const variant = resolveVariant(
    status,
    shaamStatus,
    dict,
    partial,
    importedFromExternal,
  );
  const sizeClass = size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1";
  return (
    <Badge
      variant="outline"
      className={`inline-flex items-center gap-1 border ${variant.className} ${sizeClass}`}
    >
      {variant.icon}
      <span>{variant.label}</span>
    </Badge>
  );
}
