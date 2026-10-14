"use client";

import type { EntityType } from "@/db/schema/business-entities";
import { useI18n } from "@/lib/i18n/client";
import { Building2 } from "lucide-react";

const CORPORATE_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  "CHEVRA_BAAM",
  "AMUTA",
  "SHUTAFUT",
]);

function replacePlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}

export interface OauthEntityContextProps {
  legalName: string;
  osekMurshe: string | null;
  entityType: EntityType;
}

export function OauthEntityContext({
  legalName,
  osekMurshe,
  entityType,
}: OauthEntityContextProps) {
  const { dict } = useI18n();
  const oauth = dict.onboarding.ita.oauth;
  const identifierLabels = dict.businessEntity.label.identifier;
  const entityTypeLabels = dict.businessEntity.entityType;

  const taxIdLabel =
    identifierLabels[entityType as keyof typeof identifierLabels] ??
    dict.businessEntity.label.identifier.OSEK_MURSHE;
  const entityTypeLabel =
    entityTypeLabels[entityType as keyof typeof entityTypeLabels] ?? entityType;

  const hintTemplate = CORPORATE_ENTITY_TYPES.has(entityType)
    ? oauth.govIlCorporate
    : oauth.govIlSole;

  const hint =
    osekMurshe?.trim() &&
    replacePlaceholders(hintTemplate, {
      legalName,
      taxId: osekMurshe.trim(),
      entityTypeLabel,
    });

  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/80 p-4 text-sm text-gray-900">
      <p className="font-medium text-indigo-950">{oauth.connectingBoxTitle}</p>
      <div className="flex gap-3">
        <Building2
          className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700"
          aria-hidden
        />
        <dl className="grid min-w-0 grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          <dt className="text-gray-600">{dict.businessEntity.label.legalName}</dt>
          <dd className="font-medium">{legalName}</dd>
          <dt className="text-gray-600">{dict.businessEntity.label.entityType}</dt>
          <dd>{entityTypeLabel}</dd>
          <dt className="text-gray-600">{taxIdLabel}</dt>
          <dd className="font-mono tabular-nums">
            {osekMurshe?.trim() ? (
              osekMurshe.trim()
            ) : (
              <span className="font-sans text-amber-900">{oauth.taxIdMissing}</span>
            )}
          </dd>
        </dl>
      </div>
      <p className="text-gray-800">{oauth.govIlSteps}</p>
      {hint ? <p className="text-gray-800">{hint}</p> : null}
    </div>
  );
}
