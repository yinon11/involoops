import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { getDictionary } from "@/lib/i18n/server";
import { UniformStructurePanel } from "@/features/generator/components/uniform-structure/uniform-structure-panel";

export const metadata = {
  title: "Uniform Structure · Admin",
  robots: { index: false, follow: false },
};

export default async function AdminUniformStructurePage() {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    notFound();
  }
  const dict = await getDictionary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{dict.admin.nav.uniformStructure}</h1>
        <p className="text-sm text-gray-500">{dict.uniformStructure.adminSubline}</p>
      </div>
      <UniformStructurePanel />
    </div>
  );
}
