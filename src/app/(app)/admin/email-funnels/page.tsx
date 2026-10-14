import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { EmailFunnelsClient } from "@/components/admin/email-funnels/email-funnels-client";
import {
  getFunnelGroups,
  getAllFunnels,
  getFunnelUserById,
  getUserActiveFunnels,
  getUserEmailHistory,
  type AdminUserSearch,
  type AdminUserFunnelState,
  type AdminUserEmail,
} from "@/actions/email-funnel-admin-actions";
import { areEmailFunnelsEnabled } from "@/lib/email/funnel-enabled";

export const metadata = {
  title: "Email funnels",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ userId?: string | string[] }>;
}

export default async function AdminEmailFunnelsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    notFound();
  }

  const sp = await searchParams;
  const rawUserId = Array.isArray(sp.userId) ? sp.userId[0] : sp.userId;
  const userId = rawUserId?.trim() || null;

  const [groups, funnels, initialUser, initialUserFunnels, initialUserEmails] =
    await Promise.all([
      getFunnelGroups(),
      getAllFunnels(),
      userId ? getFunnelUserById(userId) : Promise.resolve(null),
      userId ? getUserActiveFunnels(userId) : Promise.resolve([]),
      userId ? getUserEmailHistory(userId) : Promise.resolve([]),
    ]);

  // If a userId was supplied but the user doesn't exist, drop the
  // pre-selection rather than blowing up the page.
  const safeInitialUser: AdminUserSearch | null = initialUser ?? null;
  const safeInitialFunnels: AdminUserFunnelState[] = safeInitialUser
    ? initialUserFunnels
    : [];
  const safeInitialEmails: AdminUserEmail[] = safeInitialUser
    ? initialUserEmails
    : [];

  return (
    <EmailFunnelsClient
      groups={groups}
      funnels={funnels}
      funnelsGloballyEnabled={areEmailFunnelsEnabled()}
      initialSelectedUser={safeInitialUser}
      initialUserFunnels={safeInitialFunnels}
      initialUserEmails={safeInitialEmails}
    />
  );
}
