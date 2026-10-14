import React from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getDictionary } from "@/lib/i18n/server";
import { getProject } from "@/features/generator/actions/project-actions";
import { MilestoneTimeline } from "@/features/generator/components/projects/milestone-timeline";
import { AddMilestoneDialog } from "@/features/generator/components/projects/add-milestone-dialog";
import { ProjectNotesEditor } from "@/features/generator/components/projects/project-notes-editor";
import { getCurrencySymbol } from "@/lib/currency";

export const metadata = {
  title: "Project — InvoLoops Studio",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  await requireGeneratorAccess();
  const { id } = await params;
  const [project, dict] = await Promise.all([
    getProject(id),
    getDictionary(),
  ]);

  if (!project) notFound();

  const L = dict.shell.creator.projects;

  const statusBadge: Record<
    "active" | "completed" | "cancelled",
    { label: string; cls: string }
  > = {
    active: {
      label: L.statusActive,
      cls: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
    },
    completed: {
      label: L.statusCompleted,
      cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    },
    cancelled: {
      label: L.statusCancelled,
      cls: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
    },
  };

  const sym = getCurrencySymbol(project.currency);
  const total = Number(project.totalAmount);

  const collected = project.milestones
    .filter((m) => m.status === "paid")
    .reduce((s, m) => s + Number(m.amount), 0);
  const outstanding = project.milestones
    .filter((m) => m.status === "pending" || m.status === "invoiced")
    .reduce((s, m) => s + Number(m.amount), 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = project.milestones.filter(
    (m) =>
      m.status === "pending" && new Date(m.dueDate) < today,
  ).length;

  const pct = total > 0 ? Math.min(100, (collected / total) * 100) : 0;
  const badge = statusBadge[project.status];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Back link */}
      <Link
        href="/outbound/projects"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {L.backToProjects}
      </Link>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left column: header + milestone timeline ── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Project header */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1
                  className="truncate text-2xl font-semibold text-slate-900"
                  style={{
                    fontFamily:
                      "var(--font-geist-sans), system-ui, sans-serif",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {project.name}
                </h1>
                {project.customerName && (
                  <p className="mt-0.5 text-sm text-slate-500">
                    {project.customerName}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xl font-semibold tabular-nums text-slate-900">
                  {sym}
                  {total.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}
                >
                  {badge.label}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-5 space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-violet-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {sym}
                  {collected.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}{" "}
                  {L.summaryCollected} ({pct.toFixed(0)}%)
                </span>
                <span>
                  {sym}
                  {outstanding.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}{" "}
                  {L.summaryOutstanding}
                </span>
              </div>
            </div>
          </div>

          {/* Milestone timeline */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                {L.milestonesTitle}
              </h2>
              <AddMilestoneDialog
                projectId={project.id}
                currency={project.currency}
                labels={L}
              />
            </div>
            <MilestoneTimeline
              milestones={project.milestones}
              currency={project.currency}
              customerId={project.customerId}
              labels={L}
            />
          </div>
        </div>

        {/* ── Right column: summary + notes ── */}
        <div className="space-y-4 lg:col-span-1">
          {/* Summary card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">
              {L.summaryTitle}
            </h2>
            <div className="space-y-3">
              <SummaryRow
                label={L.totalDeal}
                value={`${sym}${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                bold
              />
              <SummaryRow
                label={L.summaryCollected}
                value={`${sym}${collected.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                tone="green"
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              />
              <SummaryRow
                label={L.summaryOutstanding}
                value={`${sym}${outstanding.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                tone={outstanding > 0 ? "amber" : "slate"}
                icon={<Clock className="h-3.5 w-3.5" />}
              />
              {overdue > 0 && (
                <SummaryRow
                  label={overdue !== 1 ? L.overdueMilestones : L.overdueMilestone}
                  value={String(overdue)}
                  tone="red"
                  icon={<AlertTriangle className="h-3.5 w-3.5" />}
                />
              )}
            </div>

            {/* Compact progress ring (CSS-based) */}
            <div className="mt-5 flex justify-center">
              <ProgressRing pct={pct} />
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              {L.notesTitle}
            </h2>
            <ProjectNotesEditor
              projectId={project.id}
              initialNotes={project.notes}
              labels={L}
            />
          </div>

          {/* Meta */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500 space-y-1">
            {project.startDate && <p>{L.started} {project.startDate}</p>}
            <p>
              {project.milestones.length}{" "}
              {project.milestones.length !== 1 ? L.milestones : L.milestone}
            </p>
            {project.currency !== "ILS" && (
              <p>{L.currency}: {project.currency}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Summary row helper ────────────────────────────────────────────────────── */

type SummaryTone = "green" | "amber" | "red" | "slate";

function SummaryRow({
  label,
  value,
  tone = "slate",
  icon,
  bold,
}: {
  label: string;
  value: string;
  tone?: SummaryTone;
  icon?: React.ReactNode;
  bold?: boolean;
}) {
  const valueCls: Record<SummaryTone, string> = {
    green: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-600",
    slate: "text-slate-900",
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-slate-500">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span
        className={`tabular-nums text-sm ${bold ? "font-bold" : "font-semibold"} ${valueCls[tone]}`}
      >
        {value}
      </span>
    </div>
  );
}

/* ─── Progress ring ─────────────────────────────────────────────────────────── */

function ProgressRing({ pct }: { pct: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      <svg
        className="-rotate-90"
        width={96}
        height={96}
        viewBox="0 0 96 96"
      >
        <circle
          cx={48}
          cy={48}
          r={r}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth={8}
        />
        <circle
          cx={48}
          cy={48}
          r={r}
          fill="none"
          stroke="#0D9488"
          strokeWidth={8}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-sm font-bold tabular-nums text-slate-900">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
