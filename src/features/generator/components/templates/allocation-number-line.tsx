"use client";

import {
  ALLOCATION_LABEL,
  splitAllocationNumber,
} from "@/lib/documents/allocation-number-display";

type Lang = "he" | "en";

interface AllocationNumberLineProps {
  allocationNumber?: string | null;
  lang: Lang;
  className?: string;
  /** Bold template header — light text on accent background */
  tone?: "default" | "inverse";
}

export function AllocationNumberLine({
  allocationNumber,
  lang,
  className = "",
  tone = "default",
}: AllocationNumberLineProps) {
  const parts = allocationNumber
    ? splitAllocationNumber(allocationNumber)
    : null;
  if (!parts) return null;

  const label = ALLOCATION_LABEL[lang];
  const labelClass =
    tone === "inverse" ? "text-white/70" : "text-gray-500";
  const monoClass =
    tone === "inverse" ? "font-mono text-white" : "font-mono text-gray-900";

  return (
    <p className={`text-sm ${className}`.trim()}>
      <span className={labelClass}>{label}:</span>{" "}
      {parts.kind === "short" ? (
        <span className={`${monoClass} font-bold`}>{parts.value}</span>
      ) : (
        <>
          <span className={monoClass}>{parts.prefix}</span>
          <span className={`${monoClass} font-bold`}>{parts.last9}</span>
        </>
      )}
    </p>
  );
}
