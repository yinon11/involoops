"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { startShaamAuthorization } from "@/actions/shaam-actions";
import { useI18n } from "@/lib/i18n/client";
import { OnboardingStepCard } from "./step-card";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  OauthEntityContext,
  type OauthEntityContextProps,
} from "./oauth-entity-context";

type Mode = "fresh" | "reauthorize" | "renew_soon";

interface Props extends OauthEntityContextProps {
  mode: Mode;
  daysLeft?: number;
  expiredAt?: Date | null;
  businessEntityId: string;
}

export function StepStartOauth({
  mode,
  daysLeft,
  expiredAt,
  businessEntityId,
  legalName,
  osekMurshe,
  entityType,
}: Props) {
  const { dict } = useI18n();
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        const { authorizationUrl } = await startShaamAuthorization({
          businessEntityId,
        });
        window.location.href = authorizationUrl;
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const titleKey =
    mode === "fresh"
      ? dict.onboarding.ita.oauth.title
      : mode === "reauthorize"
        ? dict.onboarding.ita.reauthorize.title
        : dict.onboarding.ita.renewSoon.title;
  const tone = mode === "reauthorize" ? "error" : mode === "renew_soon" ? "warning" : "neutral";

  return (
    <OnboardingStepCard title={titleKey} tone={tone}>
      {mode === "reauthorize" && expiredAt && (
        <p className="text-sm text-red-800">
          {dict.onboarding.ita.expired.banner.replace(
            "{date}",
            expiredAt.toISOString().slice(0, 10),
          )}
        </p>
      )}
      {mode === "renew_soon" && typeof daysLeft === "number" && (
        <p className="text-sm text-amber-800">
          {dict.onboarding.ita.renewSoon.banner.replace(
            "{days}",
            String(daysLeft),
          )}
        </p>
      )}
      <OauthEntityContext
        legalName={legalName}
        osekMurshe={osekMurshe}
        entityType={entityType}
      />
      <p className="text-sm text-gray-700">{dict.onboarding.ita.oauth.explain}</p>
      <Button
        onClick={run}
        disabled={isPending || !osekMurshe?.trim()}
        className="gap-2"
        size="lg"
      >
        {isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ExternalLink className="h-5 w-5" />
        )}
        {dict.onboarding.ita.oauth.cta}
      </Button>
    </OnboardingStepCard>
  );
}
