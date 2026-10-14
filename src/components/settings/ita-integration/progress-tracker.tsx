"use client";

import { useI18n } from "@/lib/i18n/client";
import { CheckCircle2, Circle } from "lucide-react";
import type { ReadinessState } from "@/lib/shaam/tenant-readiness";

interface Props {
  state: ReadinessState;
  checklist: {
    azorIshiConfirmed: boolean;
    taagidRegistered: boolean;
    morsheAlAssigned: boolean;
    osekMurshePresent: boolean;
  };
}

export function OnboardingProgressTracker({ state, checklist }: Props) {
  const { dict } = useI18n();
  const steps = [
    {
      key: "step1" as const,
      label: dict.onboarding.ita.progress.step1,
      done: checklist.osekMurshePresent,
    },
    {
      key: "step2" as const,
      label: dict.onboarding.ita.progress.step2,
      done:
        checklist.azorIshiConfirmed &&
        checklist.taagidRegistered &&
        checklist.morsheAlAssigned,
    },
    {
      key: "step3" as const,
      label: dict.onboarding.ita.progress.step3,
      done: state === "AUTHORIZED",
    },
    {
      key: "step4" as const,
      label: dict.onboarding.ita.progress.step4,
      done: state === "AUTHORIZED",
    },
  ];

  const firstIncompleteIdx = steps.findIndex((s) => !s.done);

  return (
    <ol className="flex flex-wrap items-center gap-4">
      {steps.map((step, idx) => {
        const current = idx === firstIncompleteIdx;
        return (
          <li
            key={step.key}
            className="flex items-center gap-2 text-sm"
          >
            {step.done ? (
              <CheckCircle2 className="h-5 w-5 text-green-700" />
            ) : current ? (
              <span className="relative flex h-5 w-5 items-center justify-center">
                <span className="absolute h-full w-full animate-ping rounded-full bg-indigo-400 opacity-50" />
                <Circle className="h-5 w-5 text-indigo-600" />
              </span>
            ) : (
              <Circle className="h-5 w-5 text-gray-300" />
            )}
            <span
              className={
                step.done
                  ? "text-green-700"
                  : current
                    ? "font-medium text-indigo-700"
                    : "text-gray-500"
              }
            >
              {step.label}
            </span>
            {idx < steps.length - 1 && (
              <span className="hidden text-gray-300 sm:inline">→</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
