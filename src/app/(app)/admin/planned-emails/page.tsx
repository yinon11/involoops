import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { PlannedEmailsClient } from "@/components/admin/email-funnels/planned-emails-client";
import {
  getFunnelGroups,
  getPlannedEmails,
} from "@/actions/email-funnel-admin-actions";

export const metadata = {
  title: "Planned emails",
  robots: { index: false, follow: false },
};

export default async function AdminPlannedEmailsPage() {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    notFound();
  }

  const [groups, plannedEmails] = await Promise.all([
    getFunnelGroups(),
    getPlannedEmails(),
  ]);

  return (
    <PlannedEmailsClient initialPlanned={plannedEmails} groups={groups} />
  );
}
