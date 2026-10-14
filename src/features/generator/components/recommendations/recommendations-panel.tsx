"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle2, Loader2 } from "lucide-react";
import { RecommendationCard } from "./recommendation-card";
import {
  triggerRecommendationRefresh,
  markAllRecommendationsRead,
} from "@/features/generator/actions/recommendation-actions";
import type { RecommendationItem } from "@/features/generator/actions/recommendation-actions";
import { useT } from "@/lib/i18n/client";

interface RecommendationsPanelProps {
  initialRecs: RecommendationItem[];
  /** If true, shows only the first `limit` items (for embedded homepage panel). */
  limit?: number;
}

export function RecommendationsPanel({
  initialRecs,
  limit,
}: RecommendationsPanelProps) {
  const dict = useT();
  const [recs, setRecs] = useState(initialRecs);
  const [isRefreshing, startRefreshTransition] = useTransition();

  const displayed = limit ? recs.slice(0, limit) : recs;
  const unreadCount = recs.filter((r) => !r.readAt).length;

  function handleRefresh() {
    startRefreshTransition(async () => {
      await triggerRecommendationRefresh();
      // After revalidatePath fires, the parent should re-render with fresh
      // server data. In client components that manage local state, a full
      // page refresh is the simplest approach here.
      window.location.reload();
    });
  }

  function handleMarkAllRead() {
    startRefreshTransition(async () => {
      await markAllRecommendationsRead();
      setRecs((prev) => prev.map((r) => ({ ...r, readAt: r.readAt ?? new Date() })));
    });
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-700">
            Recommendations
          </h3>
          {unreadCount > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={isRefreshing}
              className="text-[10px] font-medium text-slate-400 hover:text-slate-600"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-60"
            aria-label={dict.common.refresh}
          >
            {isRefreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Cards */}
      {displayed.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-violet-200 bg-violet-50 py-6 text-center">
          <CheckCircle2 className="h-5 w-5 text-violet-500" />
          <p className="text-sm font-medium text-violet-700">
            No new recommendations
          </p>
          <p className="text-xs text-violet-500">
            We&#39;ll notify you when there&#39;s something worth your attention.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              onDismissed={(id) =>
                setRecs((prev) => prev.filter((r) => r.id !== id))
              }
            />
          ))}
          {limit && recs.length > limit && (
            <p className="text-center text-xs text-slate-400">
              +{recs.length - limit} more recommendation{recs.length - limit !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
