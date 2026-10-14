import { Suspense } from "react";
import { FolderKanban } from "lucide-react";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getDictionary } from "@/lib/i18n/server";
import { getProjects } from "@/features/generator/actions/project-actions";
import { getCustomers } from "@/features/generator/actions/customer-actions";
import { ProjectCard } from "@/features/generator/components/projects/project-card";
import { NewProjectDialog } from "@/features/generator/components/projects/new-project-dialog";

export const metadata = {
  title: "Projects — InvoLoops Studio",
  robots: { index: false, follow: false },
};

export default async function ProjectsPage() {
  await requireGeneratorAccess();

  const [projectList, customerList, dict] = await Promise.all([
    getProjects(),
    getCustomers(),
    getDictionary(),
  ]);

  const L = dict.shell.creator.projects;
  const customers = customerList.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-100">
            <FolderKanban className="h-5 w-5" />
          </span>
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight text-slate-900"
              style={{
                fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                letterSpacing: "-0.02em",
              }}
            >
              {L.pageTitle}
            </h1>
            <p className="text-sm text-slate-500">{L.pageSubtitle}</p>
          </div>
        </div>

        <NewProjectDialog customers={customers} labels={L} />
      </div>

      {/* Project grid */}
      <Suspense fallback={
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
      }>
      </Suspense>
      {projectList.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 text-violet-400">
            <FolderKanban className="h-8 w-8" />
          </span>
          <div className="space-y-1">
            <p className="text-base font-semibold text-slate-700">
              {L.noProjectsTitle}
            </p>
            <p className="max-w-xs text-sm text-slate-400">{L.noProjectsSub}</p>
          </div>
          <NewProjectDialog customers={customers} labels={L} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projectList.map((project) => (
            <ProjectCard key={project.id} project={project} labels={L} />
          ))}
        </div>
      )}
    </div>
  );
}
