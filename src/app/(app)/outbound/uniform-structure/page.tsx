import { FileStack } from "lucide-react";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getDictionary } from "@/lib/i18n/server";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { UniformStructurePanel } from "@/features/generator/components/uniform-structure/uniform-structure-panel";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Uniform Structure — InvoLoops Studio",
  robots: { index: false, follow: false },
};

export default async function StudioUniformStructurePage() {
  const session = await requireGeneratorAccess();
  const dict = await getDictionary();
  const u = dict.uniformStructure;
  const businessEntity = await getBusinessEntityForUserOrNull(session.user.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <FileStack className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{u.pageTitle}</h1>
          <p className="text-sm text-zinc-500">{u.pageSubline}</p>
        </div>
      </div>

      {!businessEntity ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">{u.setupBusinessTitle}</p>
          <p className="mt-1 text-amber-900/90">{u.setupBusinessBody}</p>
          <Button asChild className="mt-3" size="sm">
            <Link href="/creator/business-details">{u.setupBusinessCta}</Link>
          </Button>
        </div>
      ) : (
        <UniformStructurePanel />
      )}
    </div>
  );
}
