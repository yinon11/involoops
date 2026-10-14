"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { OnboardingStepCard } from "./step-card";
import { ArrowRight } from "lucide-react";

export function StepFillOsekMurshe() {
  const { dict } = useI18n();
  return (
    <OnboardingStepCard
      title={dict.onboarding.ita.step.fillOsekMurshe.title}
      description={dict.onboarding.ita.step.fillOsekMurshe.description}
    >
      <Link href="/creator/business-details">
        <Button className="gap-2">
          {dict.onboarding.ita.step.fillOsekMurshe.cta}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </OnboardingStepCard>
  );
}
