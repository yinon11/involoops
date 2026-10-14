"use client";

import { usePendingCount } from "@/contexts/pending-count-context";

export function PendingNavBadge() {
  const { count } = usePendingCount();
  if (count <= 0) return null;

  return (
    <span
      aria-label={`${count} pending invoice${count === 1 ? "" : "s"}`}
      className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-400 px-1.5 text-[11px] font-bold leading-5 text-amber-950 shadow-sm"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
