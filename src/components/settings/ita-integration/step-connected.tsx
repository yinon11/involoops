"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import {
  revokeShaamAuthorization,
  testShaamConnection,
} from "@/actions/shaam-actions";
import { OnboardingStepCard } from "./step-card";
import type { ShaamEnvironment } from "@/db/schema/shaam-authorizations";
import { CheckCircle2, Loader2, Plug, Unlink } from "lucide-react";

interface Props {
  businessEntityId: string;
  environment: ShaamEnvironment;
  expiresAt: Date | null;
  daysUntilExpiry: number | null;
  authorizedAt: Date | null;
}

export function StepConnected({
  businessEntityId,
  environment,
  expiresAt,
  daysUntilExpiry,
  authorizedAt,
}: Props) {
  const { dict } = useI18n();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [testingToken, setTestingToken] = useState(false);
  const [tokenResult, setTokenResult] = useState<string | null>(null);

  function handleTestToken() {
    setTokenResult(null);
    setTestingToken(true);
    startTransition(async () => {
      try {
        const res = await testShaamConnection({
          businessEntityId,
          environment,
        });
        setTokenResult(
          res.ok
            ? `OK (${res.accessTokenPrefix})`
            : `${res.reason}${res.detail ? " — " + res.detail : ""}`,
        );
      } finally {
        setTestingToken(false);
      }
    });
  }

  function handleDisconnect() {
    if (!confirm(dict.onboarding.ita.disconnect.confirm.body)) return;
    startTransition(async () => {
      await revokeShaamAuthorization({ businessEntityId, environment });
      router.refresh();
    });
  }

  return (
    <OnboardingStepCard
      tone="success"
      title={dict.onboarding.ita.connected.title}
    >
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {authorizedAt && (
          <>
            <dt className="text-gray-600">
              {dict.onboarding.ita.connected.authorizedAt}
            </dt>
            <dd className="font-mono">
              {authorizedAt.toISOString().slice(0, 10)}
            </dd>
          </>
        )}
        {expiresAt && (
          <>
            <dt className="text-gray-600">
              {dict.onboarding.ita.connected.expiresOn}
            </dt>
            <dd className="font-mono">
              {expiresAt.toISOString().slice(0, 10)}
            </dd>
          </>
        )}
        {daysUntilExpiry !== null && (
          <>
            <dt className="text-gray-600">
              {dict.onboarding.ita.connected.daysLeft}
            </dt>
            <dd>
              {dict.onboarding.ita.connected.expiresIn.replace(
                "{days}",
                String(daysUntilExpiry),
              )}
            </dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTestToken}
          disabled={isPending}
          className="gap-1"
        >
          {isPending && testingToken ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          {dict.shaam.action.test}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDisconnect}
          disabled={isPending}
          className="gap-1 text-red-700"
        >
          <Unlink className="h-3.5 w-3.5" />
          {dict.shaam.action.revoke}
        </Button>
      </div>
      {tokenResult && (
        <p className="flex items-start gap-1 text-xs text-gray-700">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-700" />
          <span>
            <span className="font-medium">{dict.shaam.action.test}: </span>
            {tokenResult}
          </span>
        </p>
      )}
    </OnboardingStepCard>
  );
}
