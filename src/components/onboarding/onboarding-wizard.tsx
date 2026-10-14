"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";
import {
  saveOnboardingStep,
  completeOnboarding,
} from "@/actions/onboarding-actions";
import { toast } from "sonner";

interface OnboardingWizardProps {
  initialName: string;
  initialBusinessType: "freelancer" | "small_business" | null;
  initialStep: number;
}

const TOTAL_STEPS = 2;

type BusinessType = "freelancer" | "small_business";

export function OnboardingWizard({
  initialName,
  initialBusinessType,
  initialStep,
}: OnboardingWizardProps) {
  const dict = useT().welcomeWizard;
  const router = useRouter();
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 1), TOTAL_STEPS) || 1);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(initialName);
  const [businessType, setBusinessType] = useState<BusinessType | null>(
    initialBusinessType,
  );

  const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS));

  const handleStep1 = () => {
    if (!name.trim()) {
      toast.error(dict.errors.nameRequired);
      return;
    }
    if (!businessType) {
      toast.error(dict.errors.typeRequired);
      return;
    }
    startTransition(async () => {
      try {
        await saveOnboardingStep(1, { name, businessType });
        goNext();
      } catch {
        toast.error(dict.errors.saveFailed);
      }
    });
  };

  const finish = (target: "/outbound/new" | "/") => {
    startTransition(async () => {
      try {
        await completeOnboarding();
        router.push(target);
        router.refresh();
      } catch {
        toast.error(dict.errors.saveFailed);
      }
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAF7] px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <ProgressDots current={step} total={TOTAL_STEPS} />
        <p className="mt-1 text-center text-xs text-slate-500">
          {format(dict.progress, { current: step, total: TOTAL_STEPS })}
        </p>

        {step === 1 && (
          <section className="mt-6 space-y-6">
            <header>
              <h1 className="text-2xl font-semibold text-slate-900">
                {dict.step1.title}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {dict.step1.subtitle}
              </p>
            </header>

            <div className="space-y-2">
              <Label htmlFor="onboard-name">{dict.step1.nameLabel}</Label>
              <Input
                id="onboard-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={dict.step1.namePlaceholder}
                autoFocus
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">
                {dict.step1.workLabel}
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <BusinessTypeCard
                  emoji="🧑‍💻"
                  label={dict.step1.freelancer}
                  hint={dict.step1.freelancerHint}
                  selected={businessType === "freelancer"}
                  onClick={() => setBusinessType("freelancer")}
                />
                <BusinessTypeCard
                  emoji="🏢"
                  label={dict.step1.smallBusiness}
                  hint={dict.step1.smallBusinessHint}
                  selected={businessType === "small_business"}
                  onClick={() => setBusinessType("small_business")}
                />
              </div>
            </fieldset>

            <div className="flex justify-end">
              <Button onClick={handleStep1} disabled={pending}>
                {dict.step1.next} →
              </Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="mt-6 space-y-6 text-center">
            <div className="text-5xl">🎉</div>
            <header>
              <h1 className="text-2xl font-semibold text-slate-900">
                {dict.step2.title}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {dict.step2.subtitle}
              </p>
            </header>

            <ul className="mx-auto inline-block space-y-1 text-start text-sm text-slate-700">
              <li>
                <strong>{dict.step2.youAre}:</strong> {name}
              </li>
            </ul>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button
                variant="outline"
                onClick={() => finish("/")}
                disabled={pending}
              >
                {dict.step2.lookAround} →
              </Button>
              <Button
                onClick={() => finish("/outbound/new")}
                disabled={pending}
              >
                {dict.step2.sendFirst} →
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }, (_, i) => {
        const idx = i + 1;
        return (
          <span
            key={idx}
            className={cn(
              "h-2 w-2 rounded-full transition-colors",
              idx <= current ? "bg-violet-600" : "bg-slate-300",
            )}
          />
        );
      })}
    </div>
  );
}

function BusinessTypeCard({
  emoji,
  label,
  hint,
  selected,
  onClick,
}: {
  emoji: string;
  label: string;
  hint: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex flex-col items-start gap-1 rounded-xl border-2 p-4 text-start transition-all",
        selected
          ? "border-violet-500 bg-violet-50 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300",
      )}
    >
      <span className="text-2xl">{emoji}</span>
      <span className="text-sm font-semibold text-slate-900">{label}</span>
      <span className="text-xs text-slate-500">{hint}</span>
    </button>
  );
}
