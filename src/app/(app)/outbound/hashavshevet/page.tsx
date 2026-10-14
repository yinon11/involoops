import { BookOpenCheck } from "lucide-react";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getDictionary } from "@/lib/i18n/server";
import { getMoveinExportSettings } from "@/features/generator/actions/movein-export-actions";
import { HashavshevetTabs } from "@/features/generator/components/hashavshevet/hashavshevet-tabs";
import { CardMappingForm } from "@/features/generator/components/hashavshevet/card-mapping-form";
import { HashavshevetBusinessSetupPrompt } from "@/features/generator/components/hashavshevet/business-setup-prompt";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";

export const metadata = {
  title: "Hashavshevet — InvoLoops Studio",
  robots: { index: false, follow: false },
};

export default async function HashavshevetSettingsPage() {
  const session = await requireGeneratorAccess();
  const dict = await getDictionary();
  const businessEntity = await getBusinessEntityForUserOrNull(session.user.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
          <BookOpenCheck className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{dict.hashavshevet.pageTitle}</h1>
          <p className="text-sm text-zinc-500">{dict.hashavshevet.pageSubline}</p>
        </div>
      </div>

      <HashavshevetTabs />
      {!businessEntity ? (
        <HashavshevetBusinessSetupPrompt
          title={dict.hashavshevet.setupBusinessEntityTitle}
          body={dict.hashavshevet.setupBusinessEntityBody}
          cta={dict.hashavshevet.setupBusinessEntityCta}
        />
      ) : (
        <CardMappingForm
          initial={await getMoveinExportSettings()}
        />
      )}
    </div>
  );
}
