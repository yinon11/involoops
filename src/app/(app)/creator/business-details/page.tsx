import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getMyBusinessEntity } from "@/features/generator/actions/business-entity-actions";
import { getDictionary } from "@/lib/i18n/server";
import { BusinessEntityForm } from "@/components/settings/business-entity-form";
import { WithholdingCertificateCard } from "@/features/generator/components/outbound/withholding-certificate-card";
import { todayInIsrael } from "@/lib/datetime/today";
import { isWithholdingCertificateExpired } from "@/lib/documents/withholding-certificate";

export const metadata = {
  title: "Business Details · Studio",
  robots: { index: false, follow: false },
};

/**
 * First-time setup AND ongoing edit screen for the user's business
 * entity. Lives under the studio (formerly /settings/business-entity)
 * because saving this form is what actually creates the underlying
 * `business_entities` row — there is no longer an auto-created stub
 * at signup.
 *
 * If the user has never saved here, `entity` is `null` and the form
 * renders with empty defaults; the first submit INSERTs the row and
 * grants the caller OWNER membership in the same transaction.
 */
export default async function BusinessDetailsPage() {
  await requireGeneratorAccess();

  const [entity, dict] = await Promise.all([
    getMyBusinessEntity(),
    getDictionary(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {dict.businessEntity.pageTitle}
        </h1>
        <p className="text-sm text-gray-500">
          {dict.businessEntity.pageDescription}
        </p>
      </div>

      <BusinessEntityForm
        initial={{
          legalName: entity?.legalName ?? "",
          legalNameEn: entity?.legalNameEn ?? "",
          osekMurshe: entity?.osekMurshe ?? "",
          entityType: entity?.entityType ?? "OSEK_MURSHE",
          address: entity?.address ?? null,
          phone: entity?.phone ?? "",
          email: entity?.email ?? "",
          taxYearStartsMonth: entity?.taxYearStartsMonth ?? 1,
          defaultVatInclusive: entity?.defaultVatInclusive ?? true,
        }}
        labels={dict.businessEntity}
      />

      {entity && (
        <WithholdingCertificateCard
          initial={{
            filename: entity.withholdingCertificateFilename,
            uploadedAt: entity.withholdingCertificateUploadedAt?.toISOString() ?? null,
            validUntil: entity.withholdingCertificateValidUntil,
            attach: entity.attachWithholdingCertificate,
            expired: isWithholdingCertificateExpired(
              entity.withholdingCertificateValidUntil,
              todayInIsrael(),
            ),
          }}
        />
      )}
    </div>
  );
}
