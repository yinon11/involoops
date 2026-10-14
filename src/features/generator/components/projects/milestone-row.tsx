"use client";

import Link from "next/link";
import { ExternalLink, FileText, Trash2 } from "lucide-react";
import { getCurrencySymbol } from "@/lib/currency";
import { deleteMilestone, updateMilestone } from "@/features/generator/actions/project-actions";
import { useTransition } from "react";
import type { MilestoneWithInvoice } from "@/features/generator/actions/project-actions";
import { useT } from "@/lib/i18n/client";

interface MilestoneRowLabels {
  milestonePending: string;
  milestoneInvoiced: string;
  milestonePaid: string;
  milestoneDue: string;
  milestoneOverduePrefix: string;
  issueInvoice: string;
  markPaid: string;
  deleteConfirm: string;
}

interface MilestoneRowProps {
  milestone: MilestoneWithInvoice;
  currency: string;
  customerId: string | null;
  labels: MilestoneRowLabels;
}

type DueTone = "overdue" | "soon" | "ok";

function getDueTone(dueDate: string, status: MilestoneWithInvoice["status"]): DueTone {
  if (status !== "pending") return "ok";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  const diffDays = Math.ceil(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return "overdue";
  if (diffDays <= 14) return "soon";
  return "ok";
}

const BORDER_COLOR: Record<MilestoneWithInvoice["status"], string> = {
  pending: "border-amber-400",
  invoiced: "border-blue-400",
  paid: "border-emerald-400",
};

const DUE_TONE_CLS: Record<DueTone, string> = {
  overdue: "text-red-600",
  soon: "text-amber-600",
  ok: "text-slate-500",
};

export function MilestoneRow({ milestone, currency, customerId, labels }: MilestoneRowProps) {
  const dict = useT();
  const [isPending, startTransition] = useTransition();
  const sym = getCurrencySymbol(currency);
  const amount = Number(milestone.amount);
  const dueTone = getDueTone(milestone.dueDate, milestone.status);

  const statusBadge: Record<
    MilestoneWithInvoice["status"],
    { label: string; cls: string }
  > = {
    pending: { label: labels.milestonePending, cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
    invoiced: { label: labels.milestoneInvoiced, cls: "bg-blue-50 text-blue-700 ring-1 ring-blue-200" },
    paid: { label: labels.milestonePaid, cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  };
  const badge = statusBadge[milestone.status];

  const issueInvoiceUrl = (() => {
    const params = new URLSearchParams();
    params.set("amount", String(amount));
    if (customerId) params.set("customerId", customerId);
    params.set("milestoneId", milestone.id);
    params.set("projectId", milestone.projectId);
    return `/outbound/new?${params.toString()}`;
  })();

  function handleMarkPaid() {
    startTransition(async () => {
      await updateMilestone(milestone.id, { status: "paid" });
    });
  }

  function handleDelete() {
    if (!confirm(labels.deleteConfirm)) return;
    startTransition(async () => {
      await deleteMilestone(milestone.id);
    });
  }

  return (
    <div
      className={`relative flex items-start gap-4 rounded-xl border-s-4 bg-white ps-4 pe-4 py-4 shadow-sm ${BORDER_COLOR[milestone.status]} ${isPending ? "opacity-60" : ""}`}
    >
      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">{milestone.title}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.cls}`}
          >
            {badge.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-slate-500">
          <span className="tabular-nums font-semibold text-slate-800">
            {sym}
            {amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
          <span className={DUE_TONE_CLS[dueTone]}>
            {dueTone === "overdue" ? labels.milestoneOverduePrefix : ""}
            {labels.milestoneDue} {milestone.dueDate}
          </span>
          {milestone.notes && (
            <span className="italic text-slate-400">{milestone.notes}</span>
          )}
        </div>

        {/* Invoice link if already invoiced/paid */}
        {milestone.invoiceNumber && milestone.outboundInvoiceId && (
          <Link
            href={`/outbound/${milestone.outboundInvoiceId}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900 hover:underline"
          >
            <FileText className="h-3 w-3" />
            {milestone.invoiceNumber}
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1.5">
        {milestone.status === "pending" && (
          <Link
            href={issueInvoiceUrl}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 hover:text-violet-800"
          >
            <FileText className="h-3.5 w-3.5" />
            {labels.issueInvoice}
          </Link>
        )}

        {milestone.status === "invoiced" && (
          <button
            onClick={handleMarkPaid}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            {labels.markPaid}
          </button>
        )}

        {milestone.status === "pending" && !milestone.outboundInvoiceId && (
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
            aria-label={dict.common.delete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
