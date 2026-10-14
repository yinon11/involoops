"use client";

import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RecommendationsPanel } from "./recommendations-panel";
import type { RecommendationItem } from "@/features/generator/actions/recommendation-actions";

interface RecommendationsBellProps {
  initialRecs: RecommendationItem[];
  unreadCount: number;
  /** Override trigger styles (e.g. classic expense shell gradient header). */
  triggerClassName?: string;
}

export function RecommendationsBell({
  initialRecs,
  unreadCount,
  triggerClassName,
}: RecommendationsBellProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={
            triggerClassName ??
            "relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          }
          aria-label={`Recommendations${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[360px] max-h-[480px] overflow-y-auto p-4"
      >
        <RecommendationsPanel initialRecs={initialRecs} />
      </PopoverContent>
    </Popover>
  );
}
