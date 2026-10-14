"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { confirmReadinessStep } from "@/actions/shaam-actions";
import { OnboardingStepCard } from "./step-card";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

interface Props {
  step: "azorIshi" | "taagid" | "morsheAl";
  title: string;
  description: string;
  helpUrl: string;
  helpLabel: string;
  confirmLabel: string;
}

export function StepConfirmChecklist(props: Props) {
  const { step, title, description, helpUrl, helpLabel, confirmLabel } = props;
  void useI18n();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [checked, setChecked] = useState(false);

  function submit() {
    if (!checked) return;
    startTransition(async () => {
      await confirmReadinessStep({ step, confirmed: true });
      router.refresh();
    });
  }

  return (
    <OnboardingStepCard title={title} description={description}>
      <a
        href={helpUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline"
      >
        <ExternalLink className="h-4 w-4" />
        {helpLabel}
      </a>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-1 h-4 w-4"
        />
        <span>{confirmLabel}</span>
      </label>
      <Button onClick={submit} disabled={!checked || isPending} className="gap-2">
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        Continue
      </Button>
    </OnboardingStepCard>
  );
}
