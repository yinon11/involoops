import { MilestoneRow } from "./milestone-row";
import type { MilestoneWithInvoice } from "@/features/generator/actions/project-actions";

interface MilestoneLabels {
  noMilestonesYet: string;
  addFirstMilestone: string;
  milestonePending: string;
  milestoneInvoiced: string;
  milestonePaid: string;
  milestoneDue: string;
  milestoneOverduePrefix: string;
  issueInvoice: string;
  markPaid: string;
  deleteConfirm: string;
}

interface MilestoneTimelineProps {
  milestones: MilestoneWithInvoice[];
  currency: string;
  customerId: string | null;
  labels: MilestoneLabels;
}

export function MilestoneTimeline({
  milestones,
  currency,
  customerId,
  labels,
}: MilestoneTimelineProps) {
  if (milestones.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-14 text-center">
        <p className="text-sm font-medium text-slate-500">{labels.noMilestonesYet}</p>
        <p className="text-xs text-slate-400">{labels.addFirstMilestone}</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-3">
      {/* Vertical connector line */}
      <div
        aria-hidden
        className="absolute start-[1.625rem] top-6 bottom-6 w-px bg-slate-100"
      />
      {milestones.map((m) => (
        <MilestoneRow
          key={m.id}
          milestone={m}
          currency={currency}
          customerId={customerId}
          labels={labels}
        />
      ))}
    </div>
  );
}
