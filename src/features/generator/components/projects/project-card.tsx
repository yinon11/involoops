"use client";

import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { getCurrencySymbol } from "@/lib/currency";
import type { ProjectListItem } from "@/features/generator/actions/project-actions";

interface ProjectCardLabels {
  statusActive: string;
  statusCompleted: string;
  statusCancelled: string;
  collected: string;
  outstanding: string;
  overdue: string;
  due: string;
  allClear: string;
  milestone: string;
  milestones: string;
  percentCollected: string;
}

interface ProjectCardProps {
  project: ProjectListItem;
  labels: ProjectCardLabels;
}

function dueDateTone(
  nextDueDate: string | null,
): "overdue" | "soon" | "ok" | "none" {
  if (!nextDueDate) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextDueDate);
  const diffDays = Math.ceil(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return "overdue";
  if (diffDays <= 14) return "soon";
  return "ok";
}

const DUE_TONE_CLASSES = {
  overdue: "text-red-600 bg-red-50 ring-1 ring-red-200",
  soon: "text-amber-700 bg-amber-50 ring-1 ring-amber-200",
  ok: "text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200",
  none: "text-slate-500 bg-slate-50 ring-1 ring-slate-200",
};

const DUE_ICONS = {
  overdue: AlertCircle,
  soon: Clock,
  ok: Calendar,
  none: Calendar,
};

export function ProjectCard({ project, labels }: ProjectCardProps) {
  const sym = getCurrencySymbol(project.currency);
  const total = Number(project.totalAmount);
  const pct = total > 0 ? Math.min(100, (project.collected / total) * 100) : 0;

  const tone = dueDateTone(project.nextDueDate);
  const DueIcon = DUE_ICONS[tone];

  const statusLabels: Record<ProjectListItem["status"], { label: string; cls: string }> = {
    active: { label: labels.statusActive, cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
    completed: { label: labels.statusCompleted, cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
    cancelled: { label: labels.statusCancelled, cls: "bg-slate-100 text-slate-500 ring-1 ring-slate-200" },
  };
  const statusBadge = statusLabels[project.status];

  return (
    <Link
      href={`/outbound/projects/${project.id}`}
      className="group flex flex-col gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-900 group-hover:text-emerald-800">
            {project.name}
          </p>
          {project.customerName && (
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {project.customerName}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadge.cls}`}
          >
            {statusBadge.label}
          </span>
          <ArrowRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-emerald-500 rtl:rotate-180" />
        </div>
      </div>

      {/* Amounts */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums text-slate-900">
          {sym}
          {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
        <span className="text-xs text-slate-400">
          {sym}
          {project.collected.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}{" "}
          {labels.collected}
        </span>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-400">
            {pct.toFixed(0)}{labels.percentCollected}
          </span>
          {project.outstanding > 0 && (
            <span className="text-[10px] text-slate-400">
              {sym}
              {project.outstanding.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}{" "}
              {labels.outstanding}
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-400">
          {project.totalMilestones}{" "}
          {project.totalMilestones !== 1 ? labels.milestones : labels.milestone}
        </span>
        {project.nextDueDate ? (
          <span
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${DUE_TONE_CLASSES[tone]}`}
          >
            <DueIcon className="h-3 w-3" />
            {tone === "overdue" ? labels.overdue : `${labels.due} ${project.nextDueDate}`}
          </span>
        ) : project.totalMilestones > 0 ? (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 className="h-3 w-3" />
            {labels.allClear}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
