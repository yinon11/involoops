import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { getDictionary } from "@/lib/i18n/server";
import { ComplianceStatusWidget } from "@/features/expenses/components/dashboard/compliance-status-widget";
import { Card, CardContent } from "@/components/ui/card";
import {
  FileClock,
  Archive as ArchiveIcon,
  Plug,
  FileDown,
  ArrowRight,
  Mails,
  CalendarClock,
} from "lucide-react";

export const metadata = {
  title: "Compliance Admin",
  robots: { index: false, follow: false },
};

export default async function AdminHomePage() {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    notFound();
  }
  const dict = await getDictionary();
  const L = dict.shell.admin.landing;
  const N = dict.shell.admin.nav;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-zinc-900">{L.title}</h1>
        <p className="text-sm text-zinc-500">{L.subline}</p>
      </header>

      <ComplianceStatusWidget />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <QuickLink
          href="/admin/email-funnels"
          icon={<Mails className="h-5 w-5" />}
          label={N.emailFunnels}
        />
        <QuickLink
          href="/admin/planned-emails"
          icon={<CalendarClock className="h-5 w-5" />}
          label={N.plannedEmails}
        />
        <QuickLink
          href="/admin/audit"
          icon={<FileClock className="h-5 w-5" />}
          label={L.quickAudit}
        />
        <QuickLink
          href="/admin/archive"
          icon={<ArchiveIcon className="h-5 w-5" />}
          label={L.quickArchive}
        />
        <QuickLink
          href="/admin/shaam"
          icon={<Plug className="h-5 w-5" />}
          label={L.quickShaam}
        />
        <QuickLink
          href="/admin/uniform-structure"
          icon={<FileDown className="h-5 w-5" />}
          label={L.quickUniformStructure}
        />
      </section>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link href={href} className="group">
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="flex items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-3 text-zinc-700">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 group-hover:bg-amber-50 group-hover:text-amber-600">
              {icon}
            </span>
            <span className="text-sm font-medium">{label}</span>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-400 group-hover:text-amber-600" />
        </CardContent>
      </Card>
    </Link>
  );
}
