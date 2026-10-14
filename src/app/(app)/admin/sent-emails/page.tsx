import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { SentEmailsClient } from "@/components/admin/email-funnels/sent-emails-client";
import {
  listFunnelOptions,
  listSentEmails,
} from "@/actions/email-funnel-admin-actions";

export const metadata = {
  title: "Sent emails",
  robots: { index: false, follow: false },
};

export default async function AdminSentEmailsPage() {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    notFound();
  }

  const [initialPage, funnels] = await Promise.all([
    listSentEmails({ limit: 50, offset: 0 }),
    listFunnelOptions(),
  ]);

  return <SentEmailsClient initialPage={initialPage} funnels={funnels} />;
}
