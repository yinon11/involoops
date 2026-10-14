// Spec 09 access model:
//   * Per-tenant security is enforced by `requireCallerEntity` inside
//     `shaam-actions.ts` (every mutation re-resolves the caller's
//     business entity), so this page only needs a session.
//   * Page-level access is the Studio surface (every signed-in user).
//     Issuing still requires a business entity + RBAC. Admins still pass
//     via `getUserFeatures`. Public launch is the default plan grants.

import Link from "next/link";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/lib/i18n/server";
import { getTenantReadiness } from "@/lib/shaam/tenant-readiness";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { getShaamConfig } from "@/lib/shaam/client";
import type { EntityType } from "@/db/schema/business-entities";
import { OnboardingProgressTracker } from "@/components/settings/ita-integration/progress-tracker";
import { StepFillOsekMurshe } from "@/components/settings/ita-integration/step-fill-osek-murshe";
import { StepConfirmChecklist } from "@/components/settings/ita-integration/step-confirm-checklist";
import { StepStartOauth } from "@/components/settings/ita-integration/step-start-oauth";
import { StepConnected } from "@/components/settings/ita-integration/step-connected";
import { SupportContactCard } from "@/components/settings/ita-integration/support-contact-card";
import { ArrowRight, BookOpen, CheckCircle2, ExternalLink, Info, ShieldAlert } from "lucide-react";
import { format } from "@/lib/i18n";

export const metadata = {
  title: "ITA Integration · Settings",
  robots: { index: false, follow: false },
};

const GOV_AZOR_ISHI_URL = "https://www.gov.il/he/departments/topics/srsherutatzmi";
const GOV_TAAGID_URL = "https://www.gov.il/he/departments/topics/srsherutatzmi";
const GOV_MORSHE_AL_URL = "https://www.gov.il/he/departments/topics/srsherutatzmi";

export default async function IntegrationIntaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireGeneratorAccess();

  const dict = await getDictionary();
  const sp = await searchParams;
  const authorizedFlag = firstParam(sp.authorized) === "1";
  const errorCode = firstParam(sp.error);
  const entity = await getBusinessEntityForUserOrNull(session.user.id);

  // First-time users have no business entity yet — the SHAAM
  // readiness/authorization records are scoped to one, so there is
  // nothing meaningful to show. Render a single CTA pointing at the
  // setup form; saving it creates the entity and brings the user
  // back to a fully populated checklist.
  if (!entity) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold">{dict.onboarding.ita.title}</h1>
          <p className="mt-2 text-sm text-gray-600">
            {dict.onboarding.ita.whyMatters}
          </p>
        </header>
        <CallbackNotice
          dict={dict}
          authorized={authorizedFlag}
          errorCode={errorCode}
          detail={firstParam(sp.detail)}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {dict.onboarding.ita.step.fillOsekMurshe.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              {dict.onboarding.ita.step.fillOsekMurshe.description}
            </p>
            <Link href="/creator/business-details">
              <Button className="gap-2">
                {dict.onboarding.ita.step.fillOsekMurshe.cta}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const env = getShaamConfig().environment;
  const snapshot = await getTenantReadiness(entity.id, env);
  const [authRow] = await loadAuthorizedAt(entity.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{dict.onboarding.ita.title}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {dict.onboarding.ita.whyMatters}
        </p>
        <Link
          href="/tutorials/ita-integration"
          className="mt-2 inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline"
        >
          <BookOpen className="h-4 w-4" />
          {dict.onboarding.ita.readTutorial}
        </Link>
      </header>

      <CallbackNotice
        dict={dict}
        authorized={authorizedFlag}
        errorCode={errorCode}
        detail={firstParam(sp.detail)}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {dict.onboarding.ita.progress.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <OnboardingProgressTracker
            state={snapshot.state}
            checklist={snapshot.checklist}
          />
        </CardContent>
      </Card>

      {renderActiveStep({
        nextAction: snapshot.nextAction,
        businessEntityId: entity.id,
        entity: snapshot.entity,
        environment: env,
        expiresAt: snapshot.authorization.expiresAt,
        daysUntilExpiry: snapshot.authorization.daysUntilExpiry,
        authorizedAt: authRow?.authorizedAt ?? null,
        dict,
      })}

      <SupportContactCard
        initialEmail={snapshot.supportContactEmail ?? ""}
        initialPhone={snapshot.supportContactPhone ?? ""}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" />
            {dict.onboarding.ita.help.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-700">
          <p>
            {dict.onboarding.ita.help.email}{" "}
            <a
              href="mailto:support@involoops.com"
              className="text-indigo-700 hover:underline"
            >
              support@involoops.com
            </a>
          </p>
          <p>
            <Link
              href="/tutorials/ita-integration"
              className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {dict.onboarding.ita.help.troubleshooting}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function CallbackNotice({
  dict,
  authorized,
  errorCode,
  detail,
}: {
  dict: Awaited<ReturnType<typeof getDictionary>>;
  authorized: boolean;
  errorCode: string | undefined;
  detail: string | undefined;
}) {
  if (!authorized && !errorCode) return null;
  const errorText =
    errorCode === "invalid_state"
      ? dict.shaam.callback.error.invalidState
      : errorCode === "access_denied"
        ? dict.shaam.callback.error.accessDenied
        : errorCode
          ? format(dict.shaam.callback.error.exchangeFailed, {
              detail: detail ?? errorCode,
            })
          : null;
  return (
    <>
      {authorized && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <CheckCircle2 className="h-4 w-4" />
          {dict.shaam.callback.success}
        </div>
      )}
      {errorText && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <ShieldAlert className="h-4 w-4" />
          {errorText}
        </div>
      )}
    </>
  );
}

async function loadAuthorizedAt(businessEntityId: string) {
  const { db } = await import("@/db");
  const { shaamAuthorizations } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const env = getShaamConfig().environment;
  return db
    .select({ authorizedAt: shaamAuthorizations.authorizedAt })
    .from(shaamAuthorizations)
    .where(
      and(
        eq(shaamAuthorizations.businessEntityId, businessEntityId),
        eq(shaamAuthorizations.environment, env),
      ),
    )
    .limit(1);
}

function renderActiveStep(params: {
  nextAction: Awaited<ReturnType<typeof getTenantReadiness>>["nextAction"];
  businessEntityId: string;
  entity: Awaited<ReturnType<typeof getTenantReadiness>>["entity"];
  environment: ReturnType<typeof getShaamConfig>["environment"];
  expiresAt: Date | null;
  daysUntilExpiry: number | null;
  authorizedAt: Date | null;
  dict: Awaited<ReturnType<typeof getDictionary>>;
}) {
  const {
    nextAction,
    businessEntityId,
    entity,
    environment,
    expiresAt,
    daysUntilExpiry,
    authorizedAt,
    dict,
  } = params;
  const oauthEntity = {
    legalName: entity.legalName,
    osekMurshe: entity.osekMurshe,
    entityType: entity.entityType as EntityType,
  };
  switch (nextAction.kind) {
    case "FILL_OSEK_MURSHE":
      return <StepFillOsekMurshe />;
    case "CONFIRM_AZOR_ISHI":
      return (
        <StepConfirmChecklist
          step="azorIshi"
          title={dict.onboarding.ita.step.azorIshi.title}
          description={dict.onboarding.ita.step.azorIshi.description}
          helpUrl={GOV_AZOR_ISHI_URL}
          helpLabel={dict.onboarding.ita.step.azorIshi.link}
          confirmLabel={dict.onboarding.ita.step.azorIshi.confirm}
        />
      );
    case "CONFIRM_TAAGID":
      return (
        <StepConfirmChecklist
          step="taagid"
          title={dict.onboarding.ita.step.taagid.title}
          description={dict.onboarding.ita.step.taagid.explain}
          helpUrl={GOV_TAAGID_URL}
          helpLabel={dict.onboarding.ita.step.taagid.link}
          confirmLabel={dict.onboarding.ita.step.taagid.confirm}
        />
      );
    case "CONFIRM_MORSHE_AL":
      return (
        <StepConfirmChecklist
          step="morsheAl"
          title={dict.onboarding.ita.step.morsheAl.title}
          description={dict.onboarding.ita.step.morsheAl.explain}
          helpUrl={GOV_MORSHE_AL_URL}
          helpLabel={dict.onboarding.ita.step.morsheAl.link}
          confirmLabel={dict.onboarding.ita.step.morsheAl.confirm}
        />
      );
    case "START_OAUTH":
      return (
        <StepStartOauth
          mode="fresh"
          businessEntityId={businessEntityId}
          {...oauthEntity}
        />
      );
    case "REAUTHORIZE":
      return (
        <StepStartOauth
          mode="reauthorize"
          businessEntityId={businessEntityId}
          expiredAt={expiresAt}
          {...oauthEntity}
        />
      );
    case "RENEW_SOON":
      return (
        <StepStartOauth
          mode="renew_soon"
          businessEntityId={businessEntityId}
          daysLeft={nextAction.daysLeft}
          {...oauthEntity}
        />
      );
    case "NONE":
      return (
        <StepConnected
          businessEntityId={businessEntityId}
          environment={environment}
          expiresAt={expiresAt}
          daysUntilExpiry={daysUntilExpiry}
          authorizedAt={authorizedAt}
        />
      );
  }
}
