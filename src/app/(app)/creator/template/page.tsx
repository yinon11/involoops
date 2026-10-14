import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { auth } from "@/auth";
import { getDefaultTemplate } from "@/features/generator/actions/template-actions";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import {
  buildIssuerIdentityFromEntity,
  MissingIssuerIdentityError,
  type IssuerIdentity,
} from "@/lib/documents/issuer-identity";
import { resolveTemplateLogo } from "@/lib/templates/logo";
import { getDictionary } from "@/lib/i18n/server";
import { TemplateSettingsCard } from "@/components/settings/template-settings-card";

export const metadata = {
  title: "Invoice template | InvoLoops Studio",
  robots: { index: false, follow: false },
};

/**
 * Branding/template editor for Studio. Lives under /creator/* so it
 * sits with the Studio sidebar. Any signed-in user can open it;
 * issuing still requires a business entity.
 */
export default async function CreatorTemplatePage() {
  await requireGeneratorAccess();

  const session = await auth();
  const [defaultTemplate, dict, businessEntity] = await Promise.all([
    getDefaultTemplate().catch(() => null),
    getDictionary(),
    session?.user?.id
      ? getBusinessEntityForUserOrNull(session.user.id)
      : Promise.resolve(null),
  ]);

  // The editor previews the *real* issuer identity rather than the
  // legacy template columns, so what the user sees here is what a
  // rendered invoice prints. Any signed-in user can open this page,
  // including one who has not created a business entity yet — show
  // empty identity in that case instead of throwing.
  let identity: IssuerIdentity = { name: "", taxId: null, address: "" };
  if (businessEntity) {
    try {
      identity = buildIssuerIdentityFromEntity(businessEntity);
    } catch (err) {
      if (!(err instanceof MissingIssuerIdentityError)) throw err;
    }
  }
  const logoPreviewUrl = await resolveTemplateLogo(
    defaultTemplate?.logoUrl ?? null,
  );
  const t = dict.shell.creator.template;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">{t.pageTitle}</h1>
        <p className="text-sm text-slate-500">{t.pageSubtitle}</p>
      </header>

      <TemplateSettingsCard
        identity={{
          name: identity.name,
          address: identity.address,
          taxId: identity.taxId ?? "",
          hasEntity: Boolean(businessEntity),
        }}
        settingsContact={{
          phone: businessEntity?.phone ?? "",
          email: businessEntity?.email ?? "",
        }}
        initialTemplate={
          defaultTemplate
            ? {
                id: defaultTemplate.id,
                name: defaultTemplate.name,
                designId: defaultTemplate.designId,
                accentColor: defaultTemplate.accentColor,
                logoUrl: defaultTemplate.logoUrl,
                logoPreviewUrl,
                businessPhone: defaultTemplate.businessPhone,
                businessEmail: defaultTemplate.businessEmail,
                businessWebsite: defaultTemplate.businessWebsite,
                showVatBreakdown: defaultTemplate.showVatBreakdown,
                showBankDetails: defaultTemplate.showBankDetails,
                bankAccountHolder: defaultTemplate.bankAccountHolder,
                bankName: defaultTemplate.bankName,
                bankBranch: defaultTemplate.bankBranch,
                bankAccountNumber: defaultTemplate.bankAccountNumber,
                bankIban: defaultTemplate.bankIban,
                bankSwift: defaultTemplate.bankSwift,
                bankTransferNote: defaultTemplate.bankTransferNote,
                defaultCurrency: defaultTemplate.defaultCurrency,
                defaultLanguage: defaultTemplate.defaultLanguage,
              }
            : null
        }
      />
    </div>
  );
}
