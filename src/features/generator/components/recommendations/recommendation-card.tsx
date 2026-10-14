"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, AlertCircle, Calendar, Receipt, TrendingUp, Search } from "lucide-react";
import { dismissRecommendation, markRecommendationRead } from "@/features/generator/actions/recommendation-actions";
import type { RecommendationItem } from "@/features/generator/actions/recommendation-actions";
import type { RecommendationPriority, RecommendationType } from "@/db/schema/recommendations";
import { useT } from "@/lib/i18n/client";

interface RecommendationCardProps {
  rec: RecommendationItem;
  onDismissed: (id: string) => void;
}

function hrefFor(rec: RecommendationItem): string {
  switch (rec.type) {
    case "overdue_invoice":
      return "/outbound/collections";
    case "milestone_due":
      return "/outbound/projects";
    default:
      return "/money-in";
  }
}

// Left border + bg colours by priority
const PRIORITY_STYLE: Record<RecommendationPriority, { border: string; bg: string; dot: string }> = {
  urgent: {
    border: "border-s-red-500",
    bg: "bg-red-50",
    dot: "bg-red-500",
  },
  warning: {
    border: "border-s-amber-400",
    bg: "bg-amber-50",
    dot: "bg-amber-400",
  },
  info: {
    border: "border-s-violet-400",
    bg: "bg-violet-50",
    dot: "bg-violet-400",
  },
};

// Icons by recommendation type
const TYPE_ICON: Record<RecommendationType, React.ElementType> = {
  overdue_invoice: AlertCircle,
  milestone_due: Calendar,
  vat_refund: Receipt,
  weekly_digest: TrendingUp,
  missing_expense: Search,
  tax_bracket: TrendingUp,
};

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RecommendationCard({ rec, onDismissed }: RecommendationCardProps) {
  const dict = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const style = PRIORITY_STYLE[rec.priority];
  const Icon = TYPE_ICON[rec.type] ?? TrendingUp;
  const isUnread = !rec.readAt;

  function handleDismiss() {
    startTransition(async () => {
      await dismissRecommendation(rec.id);
      onDismissed(rec.id);
    });
  }

  function handleOpen() {
    startTransition(async () => {
      if (isUnread) await markRecommendationRead(rec.id);
      router.push(hrefFor(rec));
    });
  }

  return (
    <div
      onClick={handleOpen}
      className={`group relative flex cursor-pointer items-start gap-3 rounded-xl border border-transparent border-s-4 p-4 transition-all hover:opacity-90 ${style.border} ${style.bg} ${isUnread ? "opacity-100" : "opacity-80"} ${isPending ? "opacity-50" : ""}`}
    >
      {/* Unread dot */}
      {isUnread && (
        <span
          className={`absolute end-8 top-4 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
          aria-hidden
        />
      )}

      {/* Type icon */}
      <span className="mt-0.5 shrink-0 text-slate-500">
        <Icon className="h-4 w-4" />
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1">
        <p className={`text-sm font-semibold leading-snug text-slate-900 ${isUnread ? "font-bold" : ""}`}>
          {rec.title}
        </p>
        <p className="text-xs leading-relaxed text-slate-600">{rec.body}</p>
        <p className="text-[10px] text-slate-400">{relativeTime(rec.createdAt)}</p>
      </div>

      {/* Dismiss */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
        disabled={isPending}
        type="button"
        className="absolute end-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-white hover:text-slate-600"
        aria-label={dict.common.dismiss}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
