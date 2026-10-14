"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { FilterBar, FilterChip, FilterGroup } from "./filter-bar";
import { HOME_RANGES, type HomeRange } from "@/lib/dashboard/home-window";

/**
 * Time frame for the home dashboard. The choice lives in the URL so the
 * numbers stay a server render and a view can be bookmarked.
 */
export function HomePeriodFilter({
  range,
  labels,
}: {
  range: HomeRange;
  labels: { when: string } & Record<HomeRange, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function apply(next: HomeRange) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "last30") params.delete("range");
    else params.set("range", next);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  }

  return (
    <div className={isPending ? "opacity-60 transition-opacity" : undefined}>
      <FilterBar>
        <FilterGroup label={labels.when}>
          {HOME_RANGES.map((key) => (
            <FilterChip
              key={key}
              selected={range === key}
              onClick={() => apply(key)}
            >
              {labels[key]}
            </FilterChip>
          ))}
        </FilterGroup>
      </FilterBar>
    </div>
  );
}
